package services

import (
	"context"
	"fmt"
	"math/big"

	"fina/internal/repositories"

	"github.com/jackc/pgx/v5/pgxpool"
)

type GastoService struct {
	pool          *pgxpool.Pool
	operationRepo *repositories.OperationRepo
	auditRepo     *repositories.AuditRepo
}

func NewGastoService(pool *pgxpool.Pool, operationRepo *repositories.OperationRepo, auditRepo *repositories.AuditRepo) *GastoService {
	return &GastoService{pool: pool, operationRepo: operationRepo, auditRepo: auditRepo}
}

type GastoInput struct {
	AccountID  string  `json:"account_id"`
	CurrencyID string  `json:"currency_id"`
	Format     string  `json:"format"`
	Amount     string  `json:"amount"`
	Note       *string `json:"note,omitempty"`
}

func (s *GastoService) Execute(ctx context.Context, movementID string, input GastoInput, callerID string) error {
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

	var movType, movStatus string

	err := s.pool.QueryRow(ctx,
		`SELECT m.type, m.status
		 FROM movements m
		 WHERE m.id = $1`, movementID).
		Scan(&movType, &movStatus)
	if err != nil {
		return ErrMovementNotFound
	}
	if movType != "GASTO" {
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

	_, err = s.operationRepo.InsertMovementLine(ctx, tx, movementID, "OUT",
		input.AccountID, input.CurrencyID, input.Format, input.Amount, false)
	if err != nil {
		return fmt.Errorf("insert OUT line: %w", err)
	}

	if err := s.auditRepo.InsertTx(ctx, tx, "movement", &movementID, "gasto",
		nil,
		map[string]interface{}{
			"account_id":  input.AccountID,
			"currency_id": input.CurrencyID,
			"format":      input.Format,
			"amount":      input.Amount,
		},
		callerID); err != nil {
		return fmt.Errorf("insert gasto audit: %w", err)
	}

	if err := confirmMovementDraftTx(ctx, tx, s.pool, s.operationRepo, s.auditRepo, movementID, callerID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}
