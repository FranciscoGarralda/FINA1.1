package services

import (
	"context"
	"errors"
	"fmt"
	"math/big"

	"fina/internal/repositories"

	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNoInLines = errors.New("NO_IN_LINES")

type VentaService struct {
	pool          *pgxpool.Pool
	operationRepo *repositories.OperationRepo
	ccSvc         *CCService
	auditRepo     *repositories.AuditRepo
}

func NewVentaService(pool *pgxpool.Pool, operationRepo *repositories.OperationRepo, ccSvc *CCService, auditRepo *repositories.AuditRepo) *VentaService {
	return &VentaService{pool: pool, operationRepo: operationRepo, ccSvc: ccSvc, auditRepo: auditRepo}
}

type VentaOutLine struct {
	AccountID   string `json:"account_id"`
	CurrencyID  string `json:"currency_id"`
	Format      string `json:"format"`
	Amount      string `json:"amount"`
	PendingCash bool   `json:"pending_cash"`
}

type VentaQuote struct {
	Rate       string `json:"rate"`
	CurrencyID string `json:"currency_id"`
	Mode       string `json:"mode"`
}

type VentaInLine struct {
	AccountID   string `json:"account_id"`
	Format      string `json:"format"`
	Amount      string `json:"amount"`
	PendingCash bool   `json:"pending_cash"`
}

type VentaInput struct {
	Out   VentaOutLine  `json:"out"`
	Quote VentaQuote    `json:"quote"`
	Ins   []VentaInLine `json:"ins"`
}

func (s *VentaService) Execute(ctx context.Context, movementID string, input VentaInput, callerID string) error {
	if len(input.Ins) == 0 {
		return ErrNoInLines
	}

	soldAmt, ok := new(big.Rat).SetString(input.Out.Amount)
	if !ok || soldAmt.Sign() <= 0 {
		return ErrInvalidAmount
	}
	quoteRate, ok := new(big.Rat).SetString(input.Quote.Rate)
	if !ok || quoteRate.Sign() <= 0 {
		return ErrInvalidAmount
	}

	equivalent, err := computeEquivalentFromQuote(soldAmt, quoteRate, input.Quote.Mode)
	if err != nil {
		return err
	}

	inSum := new(big.Rat)
	for _, in_ := range input.Ins {
		amt, ok := new(big.Rat).SetString(in_.Amount)
		if !ok || amt.Sign() <= 0 {
			return ErrInvalidAmount
		}
		inSum.Add(inSum, amt)
	}

	if !cuadreVentaOK(equivalent, inSum, soldAmt, quoteRate, input.Quote.Mode) {
		return ErrCuadreNotMatch
	}

	if err := validateFormat(input.Out.Format); err != nil {
		return err
	}
	for _, in_ := range input.Ins {
		if err := validateFormat(in_.Format); err != nil {
			return err
		}
	}

	if err := s.operationRepo.ValidateAccountCurrencyFormat(ctx, input.Out.AccountID, input.Out.CurrencyID, input.Out.Format); err != nil {
		return err
	}
	for _, in_ := range input.Ins {
		if err := s.operationRepo.ValidateAccountCurrencyFormat(ctx, in_.AccountID, input.Quote.CurrencyID, in_.Format); err != nil {
			return err
		}
	}

	_, _, clientID, ccEnabled, err := lookupMovementForExecution(ctx, s.pool, movementID, "VENTA")
	if err != nil {
		return err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// OUT line (single — divisa vendida) — Tabla maestra (Fix Venta:
	// simetría CC + reclasificación pendientes — H-007/H-008/H-009/H-010).
	// Etiqueta UI unificada: OUT pendiente = "Pendiente de pago" (la casa
	// debe entregar divisa al cliente).
	outPending := input.Out.PendingCash && input.Out.Format == "CASH"
	outLineID, err := s.operationRepo.InsertMovementLine(ctx, tx, movementID, "OUT",
		input.Out.AccountID, input.Out.CurrencyID, input.Out.Format, input.Out.Amount, outPending)
	if err != nil {
		return fmt.Errorf("insert OUT line: %w", err)
	}
	outEffect := decideVentaLineEffect(ccEnabled, outPending)
	if outEffect.ApplyCC {
		// H-013: la casa todavía no entregó la divisa al cliente, por lo que
		// la casa le DEBE al cliente. Convención CC del sistema (cc_service.go:37,
		// cc_repo.go:56): positive = saldo a favor del cliente / debt reduction.
		// Por eso aplicamos `ccSideIn` (suma al balance del cliente).
		if err := applyCCImpactTx(ctx, s.ccSvc, tx, clientID, input.Out.CurrencyID, input.Out.Amount, movementID, ccSideIn, "Venta — divisa pendiente de entregar al cliente", callerID); err != nil {
			return fmt.Errorf("apply cc impact OUT: %w", err)
		}
	}
	if outEffect.InsertPending {
		if _, err = s.operationRepo.InsertPendingItem(ctx, tx, outLineID, "PENDIENTE_DE_RETIRO",
			clientID, input.Out.CurrencyID, input.Out.Amount, true); err != nil {
			return fmt.Errorf("insert OUT pending: %w", err)
		}
	}

	// IN lines (multiple — divisa cotización). Etiqueta UI unificada: IN
	// pendiente = "Pendiente de cobro" (el cliente debe pagarnos).
	for i, in_ := range input.Ins {
		inPending := in_.PendingCash && in_.Format == "CASH"
		inLineID, err := s.operationRepo.InsertMovementLine(ctx, tx, movementID, "IN",
			in_.AccountID, input.Quote.CurrencyID, in_.Format, in_.Amount, inPending)
		if err != nil {
			return fmt.Errorf("insert IN line %d: %w", i, err)
		}
		inEffect := decideVentaLineEffect(ccEnabled, inPending)
		if inEffect.ApplyCC {
			// H-014: el cliente todavía no nos pagó, por lo que el cliente le
			// DEBE a la casa. Convención CC del sistema (cc_service.go:37,
			// cc_repo.go:56): negative = client owes more.
			// Por eso aplicamos `ccSideOut` (resta al balance del cliente).
			if err := applyCCImpactTx(ctx, s.ccSvc, tx, clientID, input.Quote.CurrencyID, in_.Amount, movementID, ccSideOut, "Venta — pago pendiente del cliente", callerID); err != nil {
				return fmt.Errorf("apply cc impact IN %d: %w", i, err)
			}
		}
		if inEffect.InsertPending {
			if _, err = s.operationRepo.InsertPendingItem(ctx, tx, inLineID, "PENDIENTE_DE_PAGO",
				clientID, input.Quote.CurrencyID, in_.Amount, true); err != nil {
				return fmt.Errorf("insert IN pending %d: %w", i, err)
			}
		}
	}

	if err := s.auditRepo.InsertTx(ctx, tx, "movement", &movementID, "venta",
		nil,
		map[string]interface{}{
			"out_currency":   input.Out.CurrencyID,
			"out_amount":     input.Out.Amount,
			"quote_rate":     input.Quote.Rate,
			"quote_mode":     normalizeQuoteMode(input.Quote.Mode),
			"quote_currency": input.Quote.CurrencyID,
			"in_count":       len(input.Ins),
		},
		callerID); err != nil {
		return fmt.Errorf("insert venta audit: %w", err)
	}

	if err := confirmMovementDraftTx(ctx, tx, s.pool, s.operationRepo, s.auditRepo, movementID, callerID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// ventaLineEffect describe los efectos contables que hay que aplicar para una
// pata (OUT o IN) de una operación de Venta dada la configuración del cliente
// (`ccEnabled`) y si esa pata fue marcada como pendiente.
//
// Es la codificación pura (sin DB) de la Tabla maestra acordada con el usuario,
// idéntica a la usada en Compra:
//
//	ccEnabled | pending | acción
//	---------|---------|--------
//	false    | false   | solo caja (movement_line)
//	false    | true    | pending_items
//	true     | false   | solo caja (movement_line)
//	true     | true    | cc_entries (sin pending_items)
//
// Para clientes con CC, los pendientes desaparecen como concepto: lo que antes
// iba a `pending_items` ahora va directo a `cc_entries`. Para clientes sin CC,
// `pending_items` sigue funcionando como hoy.
//
// Nota (regla 12, cambios mínimos): este helper queda LOCAL en Venta y duplica
// el de Compra (`decideCompraLineEffect`). NO se comparte ni se mueve a un
// paquete común
type ventaLineEffect struct {
	InsertPending bool
	ApplyCC       bool
}

func decideVentaLineEffect(ccEnabled, pending bool) ventaLineEffect {
	switch {
	case ccEnabled && pending:
		return ventaLineEffect{ApplyCC: true}
	case !ccEnabled && pending:
		return ventaLineEffect{InsertPending: true}
	default:
		return ventaLineEffect{}
	}
}
