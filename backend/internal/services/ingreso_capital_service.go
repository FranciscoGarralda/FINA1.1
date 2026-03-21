package services

import (
	"context"
	"fmt"
	"math/big"

	"fina/internal/repositories"

	"github.com/jackc/pgx/v5/pgxpool"
)

type IngresoCapitalService struct {
	pool          *pgxpool.Pool
	operationRepo *repositories.OperationRepo
	ccSvc         *CCService
	auditRepo     *repositories.AuditRepo
}

func NewIngresoCapitalService(pool *pgxpool.Pool, operationRepo *repositories.OperationRepo, ccSvc *CCService, auditRepo *repositories.AuditRepo) *IngresoCapitalService {
	return &IngresoCapitalService{pool: pool, operationRepo: operationRepo, ccSvc: ccSvc, auditRepo: auditRepo}
}

type IngresoCapitalInput struct {
	AccountID  string  `json:"account_id"`
	CurrencyID string  `json:"currency_id"`
	Format     string  `json:"format"`
	Amount     string  `json:"amount"`
	Note       *string `json:"note,omitempty"`
}

func (s *IngresoCapitalService) Execute(ctx context.Context, movementID string, input IngresoCapitalInput, callerID string) error {
	amt, ok := new(big.Rat).SetString(input.Amount)
	if !ok || amt.Sign() <= 0 {
		return ErrInvalidAmount
	}

	if input.Format != "CASH" && input.Format != "DIGITAL" {
		return ErrInvalidAmount
	}

	if err := s.operationRepo.ValidateAccountCurrencyFormat(ctx, input.AccountID, input.CurrencyID, input.Format); err != nil {
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
	if movType != "INGRESO_CAPITAL" {
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

	_, err = s.operationRepo.InsertMovementLine(ctx, tx, movementID, "IN",
		input.AccountID, input.CurrencyID, input.Format, input.Amount, false)
	if err != nil {
		return fmt.Errorf("insert IN line: %w", err)
	}

	if ccEnabled {
		ccNote := "Ingreso de capital"
		err = applyCCImpactTx(ctx, s.ccSvc, tx, clientID, input.CurrencyID, input.Amount, movementID, ccSideIn, ccNote, callerID)
		if err != nil {
			return fmt.Errorf("apply cc_entry: %w", err)
		}
	}

	if err := s.auditRepo.InsertTx(ctx, tx, "movement", &movementID, "ingreso_capital",
		nil,
		map[string]interface{}{
			"account_id":  input.AccountID,
			"currency_id": input.CurrencyID,
			"format":      input.Format,
			"amount":      input.Amount,
			"cc_enabled":  ccEnabled,
		},
		callerID); err != nil {
		return fmt.Errorf("insert ingreso_capital audit: %w", err)
	}

	if err := confirmMovementDraftTx(ctx, tx, s.pool, s.operationRepo, s.auditRepo, movementID, callerID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}
