package services

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"strings"

	"fina/internal/repositories"

	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrProfitRequired = errors.New("PROFIT_REQUIRED")
	ErrProfitAccount  = errors.New("PROFIT_ACCOUNT_REQUIRED")
)

type ArbitrajeService struct {
	pool          *pgxpool.Pool
	operationRepo *repositories.OperationRepo
	ccSvc         *CCService
	auditRepo     *repositories.AuditRepo
}

func NewArbitrajeService(pool *pgxpool.Pool, operationRepo *repositories.OperationRepo, ccSvc *CCService, auditRepo *repositories.AuditRepo) *ArbitrajeService {
	return &ArbitrajeService{pool: pool, operationRepo: operationRepo, ccSvc: ccSvc, auditRepo: auditRepo}
}

type ArbitrajeLeg struct {
	AccountID   string `json:"account_id"`
	CurrencyID  string `json:"currency_id"`
	Format      string `json:"format"`
	Amount      string `json:"amount"`
	PendingCash bool   `json:"pending_cash"`
}

type ArbitrajeProfit struct {
	AccountID      string `json:"account_id"`
	CurrencyID     string `json:"currency_id"`
	Format         string `json:"format"`
	Amount         string `json:"amount"`
	ManualOverride bool   `json:"manual_override"`
}

type ArbitrajeInput struct {
	Costo   ArbitrajeLeg    `json:"costo"`
	Cobrado ArbitrajeLeg    `json:"cobrado"`
	Profit  ArbitrajeProfit `json:"profit"`
}

func (s *ArbitrajeService) Execute(ctx context.Context, movementID string, input ArbitrajeInput, callerID string) error {
	costoAmt, ok := new(big.Rat).SetString(input.Costo.Amount)
	if !ok || costoAmt.Sign() <= 0 {
		return ErrInvalidAmount
	}
	cobradoAmt, ok := new(big.Rat).SetString(input.Cobrado.Amount)
	if !ok || cobradoAmt.Sign() <= 0 {
		return ErrInvalidAmount
	}

	profitAmt, ok := new(big.Rat).SetString(input.Profit.Amount)
	if !ok {
		return ErrProfitRequired
	}

	if input.Profit.AccountID == "" || input.Profit.CurrencyID == "" {
		return ErrProfitAccount
	}
	if input.Profit.Format != "CASH" && input.Profit.Format != "DIGITAL" {
		return ErrInvalidAmount
	}

	for _, leg := range []ArbitrajeLeg{input.Costo, input.Cobrado} {
		if leg.Format != "CASH" && leg.Format != "DIGITAL" {
			return ErrInvalidAmount
		}
	}

	if err := s.operationRepo.ValidateAccountCurrencyFormat(ctx, input.Costo.AccountID, input.Costo.CurrencyID, input.Costo.Format); err != nil {
		return err
	}
	if err := s.operationRepo.ValidateAccountCurrencyFormat(ctx, input.Cobrado.AccountID, input.Cobrado.CurrencyID, input.Cobrado.Format); err != nil {
		return err
	}
	if err := s.operationRepo.ValidateAccountCurrencyFormat(ctx, input.Profit.AccountID, input.Profit.CurrencyID, input.Profit.Format); err != nil {
		return err
	}

	var movType, movStatus, clientID string
	var ccEnabled bool
	err := s.pool.QueryRow(ctx,
		`SELECT m.type, m.status, m.client_id::text, c.cc_enabled
		 FROM movements m
		 JOIN clients c ON c.id = m.client_id
		 WHERE m.id = $1`, movementID).
		Scan(&movType, &movStatus, &clientID, &ccEnabled)
	if err != nil {
		return ErrMovementNotFound
	}
	if movType != "ARBITRAJE" {
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

	// COSTO → OUT
	costoPending := input.Costo.PendingCash && input.Costo.Format == "CASH"
	costoLineID, err := s.operationRepo.InsertMovementLine(ctx, tx, movementID, "OUT",
		input.Costo.AccountID, input.Costo.CurrencyID, input.Costo.Format, input.Costo.Amount, costoPending)
	if err != nil {
		return fmt.Errorf("insert COSTO line: %w", err)
	}
	if costoPending {
		_, err = s.operationRepo.InsertPendingItem(ctx, tx, costoLineID, "PENDIENTE_DE_PAGO",
			clientID, input.Costo.CurrencyID, input.Costo.Amount, false)
		if err != nil {
			return fmt.Errorf("insert COSTO pending: %w", err)
		}
	}

	// COBRADO → IN
	cobradoPending := input.Cobrado.PendingCash && input.Cobrado.Format == "CASH"
	cobradoLineID, err := s.operationRepo.InsertMovementLine(ctx, tx, movementID, "IN",
		input.Cobrado.AccountID, input.Cobrado.CurrencyID, input.Cobrado.Format, input.Cobrado.Amount, cobradoPending)
	if err != nil {
		return fmt.Errorf("insert COBRADO line: %w", err)
	}
	if cobradoPending {
		_, err = s.operationRepo.InsertPendingItem(ctx, tx, cobradoLineID, "PENDIENTE_DE_RETIRO",
			clientID, input.Cobrado.CurrencyID, input.Cobrado.Amount, true)
		if err != nil {
			return fmt.Errorf("insert COBRADO pending: %w", err)
		}
	}
	if ccEnabled && !cobradoPending {
		if err := applyCCImpactTx(ctx, s.ccSvc, tx, clientID, input.Cobrado.CurrencyID, input.Cobrado.Amount, movementID, ccSideIn, "Arbitraje — cobrado", callerID); err != nil {
			return fmt.Errorf("apply cc impact cobrado: %w", err)
		}
	}

	// Profit entry (always)
	_, err = s.operationRepo.InsertProfitEntry(ctx, tx, movementID,
		input.Profit.CurrencyID, input.Profit.Amount, input.Profit.AccountID, input.Profit.Format)
	if err != nil {
		return fmt.Errorf("insert profit_entry: %w", err)
	}

	// Option A strict: profit movement_line reflecting real money
	if profitAmt.Sign() > 0 {
		_, err = s.operationRepo.InsertMovementLine(ctx, tx, movementID, "IN",
			input.Profit.AccountID, input.Profit.CurrencyID, input.Profit.Format,
			strings.TrimRight(strings.TrimRight(profitAmt.FloatString(8), "0"), "."), false)
		if err != nil {
			return fmt.Errorf("insert profit IN line: %w", err)
		}
		if ccEnabled {
			profitStr := strings.TrimRight(strings.TrimRight(profitAmt.FloatString(8), "0"), ".")
			if err := applyCCImpactTx(ctx, s.ccSvc, tx, clientID, input.Profit.CurrencyID, profitStr, movementID, ccSideIn, "Arbitraje — ganancia", callerID); err != nil {
				return fmt.Errorf("apply cc impact profit IN: %w", err)
			}
		}
	} else if profitAmt.Sign() < 0 {
		absProfit := new(big.Rat).Abs(profitAmt)
		_, err = s.operationRepo.InsertMovementLine(ctx, tx, movementID, "OUT",
			input.Profit.AccountID, input.Profit.CurrencyID, input.Profit.Format,
			strings.TrimRight(strings.TrimRight(absProfit.FloatString(8), "0"), "."), false)
		if err != nil {
			return fmt.Errorf("insert profit OUT line: %w", err)
		}
		if ccEnabled {
			absProfitStr := strings.TrimRight(strings.TrimRight(absProfit.FloatString(8), "0"), ".")
			if err := applyCCImpactTx(ctx, s.ccSvc, tx, clientID, input.Profit.CurrencyID, absProfitStr, movementID, ccSideOut, "Arbitraje — pérdida", callerID); err != nil {
				return fmt.Errorf("apply cc impact profit OUT: %w", err)
			}
		}
	}

	auditNew := map[string]interface{}{
		"costo_currency":   input.Costo.CurrencyID,
		"costo_amount":     input.Costo.Amount,
		"cobrado_currency": input.Cobrado.CurrencyID,
		"cobrado_amount":   input.Cobrado.Amount,
		"profit_amount":    input.Profit.Amount,
		"profit_currency":  input.Profit.CurrencyID,
	}
	if err := s.auditRepo.InsertTx(ctx, tx, "movement", &movementID, "arbitraje",
		nil, auditNew, callerID); err != nil {
		return fmt.Errorf("insert arbitraje audit: %w", err)
	}

	if err := confirmMovementDraftTx(ctx, tx, s.pool, s.operationRepo, s.auditRepo, movementID, callerID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}
