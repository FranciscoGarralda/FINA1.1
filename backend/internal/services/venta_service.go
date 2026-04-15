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

	eqR := RoundRatToDecimalPlaces(equivalent, 2)
	sumR := RoundRatToDecimalPlaces(inSum, 2)
	if eqR.Cmp(sumR) != 0 {
		return ErrCuadreNotMatch
	}

	if input.Out.Format != "CASH" && input.Out.Format != "DIGITAL" {
		return ErrInvalidAmount
	}
	for _, in_ := range input.Ins {
		if in_.Format != "CASH" && in_.Format != "DIGITAL" {
			return ErrInvalidAmount
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

	var movType, movStatus, clientID string
	var ccEnabled bool
	err = s.pool.QueryRow(ctx,
		`SELECT m.type, m.status, m.client_id::text, c.cc_enabled
		 FROM movements m
		 JOIN clients c ON c.id = m.client_id
		 WHERE m.id = $1`, movementID).
		Scan(&movType, &movStatus, &clientID, &ccEnabled)
	if err != nil {
		return ErrMovementNotFound
	}
	if movType != "VENTA" {
		return ErrMovementTypeMismatch
	}
	if movStatus != MovementStatusDraft {
		return ErrMovementNotDraft
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// OUT line (single — divisa vendida)
	outPending := input.Out.PendingCash && input.Out.Format == "CASH"
	outLineID, err := s.operationRepo.InsertMovementLine(ctx, tx, movementID, "OUT",
		input.Out.AccountID, input.Out.CurrencyID, input.Out.Format, input.Out.Amount, outPending)
	if err != nil {
		return fmt.Errorf("insert OUT line: %w", err)
	}

	if outPending {
		// PENDIENTE_DE_RETIRO en OUT: pendiente de entregar divisa vendida al cliente (etiqueta VENTA: "Entrega").
		_, err = s.operationRepo.InsertPendingItem(ctx, tx, outLineID, "PENDIENTE_DE_RETIRO",
			clientID, input.Out.CurrencyID, input.Out.Amount, true)
		if err != nil {
			return fmt.Errorf("insert OUT pending: %w", err)
		}
	}
	if ccEnabled && !outPending {
		if err := applyCCImpactTx(ctx, s.ccSvc, tx, clientID, input.Out.CurrencyID, input.Out.Amount, movementID, ccSideOut, "Venta — divisa vendida", callerID); err != nil {
			return fmt.Errorf("apply cc impact OUT: %w", err)
		}
	}

	// IN lines (multiple — divisa cotización)
	for i, in_ := range input.Ins {
		inPending := in_.PendingCash && in_.Format == "CASH"
		inLineID, err := s.operationRepo.InsertMovementLine(ctx, tx, movementID, "IN",
			in_.AccountID, input.Quote.CurrencyID, in_.Format, in_.Amount, inPending)
		if err != nil {
			return fmt.Errorf("insert IN line %d: %w", i, err)
		}

		if inPending {
			// PENDIENTE_DE_PAGO en IN: pendiente de cobro/retiro en caja (etiqueta VENTA: "Retiro" hacia la casa).
			_, err = s.operationRepo.InsertPendingItem(ctx, tx, inLineID, "PENDIENTE_DE_PAGO",
				clientID, input.Quote.CurrencyID, in_.Amount, true)
			if err != nil {
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
