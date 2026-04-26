package services

import (
	"context"
	"errors"
	"fmt"
	"math/big"

	"fina/internal/repositories"

	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrCuadreNotMatch       = errors.New("CUADRE_NOT_MATCH")
	ErrInvalidAmount        = errors.New("INVALID_AMOUNT")
	ErrNoOutLines           = errors.New("NO_OUT_LINES")
	ErrMovementNotFound     = errors.New("MOVEMENT_NOT_FOUND")
	ErrMovementTypeMismatch = errors.New("MOVEMENT_TYPE_MISMATCH")
)

type CompraService struct {
	pool          *pgxpool.Pool
	operationRepo *repositories.OperationRepo
	ccSvc         *CCService
	auditRepo     *repositories.AuditRepo
}

func NewCompraService(pool *pgxpool.Pool, operationRepo *repositories.OperationRepo, ccSvc *CCService, auditRepo *repositories.AuditRepo) *CompraService {
	return &CompraService{pool: pool, operationRepo: operationRepo, ccSvc: ccSvc, auditRepo: auditRepo}
}

type CompraInLine struct {
	AccountID   string `json:"account_id"`
	CurrencyID  string `json:"currency_id"`
	Format      string `json:"format"`
	Amount      string `json:"amount"`
	PendingCash bool   `json:"pending_cash"`
}

type CompraQuote struct {
	Rate       string `json:"rate"`
	CurrencyID string `json:"currency_id"`
	Mode       string `json:"mode"`
}

type CompraOutLine struct {
	AccountID   string `json:"account_id"`
	Format      string `json:"format"`
	Amount      string `json:"amount"`
	PendingCash bool   `json:"pending_cash"`
}

type CompraInput struct {
	In    CompraInLine    `json:"in"`
	Quote CompraQuote     `json:"quote"`
	Outs  []CompraOutLine `json:"outs"`
}

func (s *CompraService) Execute(ctx context.Context, movementID string, input CompraInput, callerID string) error {
	if len(input.Outs) == 0 {
		return ErrNoOutLines
	}

	boughtAmt, ok := new(big.Rat).SetString(input.In.Amount)
	if !ok || boughtAmt.Sign() <= 0 {
		return ErrInvalidAmount
	}
	quoteRate, ok := new(big.Rat).SetString(input.Quote.Rate)
	if !ok || quoteRate.Sign() <= 0 {
		return ErrInvalidAmount
	}

	equivalent, err := computeEquivalentFromQuote(boughtAmt, quoteRate, input.Quote.Mode)
	if err != nil {
		return err
	}

	outSum := new(big.Rat)
	for _, out := range input.Outs {
		amt, ok := new(big.Rat).SetString(out.Amount)
		if !ok || amt.Sign() <= 0 {
			return ErrInvalidAmount
		}
		outSum.Add(outSum, amt)
	}

	if !cuadreCompraOK(equivalent, outSum, boughtAmt, quoteRate, input.Quote.Mode) {
		return ErrCuadreNotMatch
	}

	if err := validateFormat(input.In.Format); err != nil {
		return err
	}
	for _, out := range input.Outs {
		if err := validateFormat(out.Format); err != nil {
			return err
		}
	}

	// Validate account/currency/format combos
	if err := s.operationRepo.ValidateAccountCurrencyFormat(ctx, input.In.AccountID, input.In.CurrencyID, input.In.Format); err != nil {
		return err
	}
	for _, out := range input.Outs {
		if err := s.operationRepo.ValidateAccountCurrencyFormat(ctx, out.AccountID, input.Quote.CurrencyID, out.Format); err != nil {
			return err
		}
	}

	_, _, clientID, ccEnabled, err := lookupMovementForExecution(ctx, s.pool, movementID, "COMPRA")
	if err != nil {
		return err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// IN line — Tabla maestra (Fix Compra: simetría CC + reclasificación pendientes).
	// ccEnabled+pending → solo CC (sin pending_items). ccEnabled+no-pending → solo caja.
	// !ccEnabled+pending → solo pending_items. !ccEnabled+no-pending → solo caja.
	inPending := input.In.PendingCash && input.In.Format == "CASH"
	inLineID, err := s.operationRepo.InsertMovementLine(ctx, tx, movementID, "IN",
		input.In.AccountID, input.In.CurrencyID, input.In.Format, input.In.Amount, inPending)
	if err != nil {
		return fmt.Errorf("insert IN line: %w", err)
	}
	inEffect := decideCompraLineEffect(ccEnabled, inPending)
	if inEffect.ApplyCC {
		if err := applyCCImpactTx(ctx, s.ccSvc, tx, clientID, input.In.CurrencyID, input.In.Amount, movementID, ccSideIn, "Compra — divisa pendiente de cobro al cliente", callerID); err != nil {
			return fmt.Errorf("apply cc impact IN pending: %w", err)
		}
	}
	if inEffect.InsertPending {
		if _, err = s.operationRepo.InsertPendingItem(ctx, tx, inLineID, "PENDIENTE_DE_RETIRO",
			clientID, input.In.CurrencyID, input.In.Amount, true); err != nil {
			return fmt.Errorf("insert IN pending: %w", err)
		}
	}

	// OUT lines
	for i, out := range input.Outs {
		outPending := out.PendingCash && out.Format == "CASH"
		outLineID, err := s.operationRepo.InsertMovementLine(ctx, tx, movementID, "OUT",
			out.AccountID, input.Quote.CurrencyID, out.Format, out.Amount, outPending)
		if err != nil {
			return fmt.Errorf("insert OUT line %d: %w", i, err)
		}
		outEffect := decideCompraLineEffect(ccEnabled, outPending)
		if outEffect.ApplyCC {
			if err := applyCCImpactTx(ctx, s.ccSvc, tx, clientID, input.Quote.CurrencyID, out.Amount, movementID, ccSideOut, "Compra — pago pendiente al cliente", callerID); err != nil {
				return fmt.Errorf("apply cc impact OUT pending %d: %w", i, err)
			}
		}
		if outEffect.InsertPending {
			if _, err = s.operationRepo.InsertPendingItem(ctx, tx, outLineID, "PENDIENTE_DE_PAGO",
				clientID, input.Quote.CurrencyID, out.Amount, true); err != nil {
				return fmt.Errorf("insert OUT pending %d: %w", i, err)
			}
		}
	}

	if err := s.auditRepo.InsertTx(ctx, tx, "movement", &movementID, "compra",
		nil,
		map[string]interface{}{
			"in_currency":    input.In.CurrencyID,
			"in_amount":      input.In.Amount,
			"quote_rate":     input.Quote.Rate,
			"quote_mode":     normalizeQuoteMode(input.Quote.Mode),
			"quote_currency": input.Quote.CurrencyID,
			"out_count":      len(input.Outs),
		},
		callerID); err != nil {
		return fmt.Errorf("insert compra audit: %w", err)
	}

	if err := confirmMovementDraftTx(ctx, tx, s.pool, s.operationRepo, s.auditRepo, movementID, callerID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// compraLineEffect describe los efectos contables que hay que aplicar para una
// pata (IN o OUT) de una operación de Compra dada la configuración del cliente
// (`ccEnabled`) y si esa pata fue marcada como pendiente.
//
// Es la codificación pura (sin DB) de la Tabla maestra acordada con el usuario:
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
type compraLineEffect struct {
	InsertPending bool
	ApplyCC       bool
}

func decideCompraLineEffect(ccEnabled, pending bool) compraLineEffect {
	switch {
	case ccEnabled && pending:
		return compraLineEffect{ApplyCC: true}
	case !ccEnabled && pending:
		return compraLineEffect{InsertPending: true}
	default:
		return compraLineEffect{}
	}
}
