package services

import (
	"context"
	"errors"
	"fmt"
	"math/big"

	"fina/internal/repositories"

	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrSameAccount = errors.New("SAME_ACCOUNT")

type TransferenciaEntreCuentasService struct {
	pool          *pgxpool.Pool
	operationRepo *repositories.OperationRepo
	auditRepo     *repositories.AuditRepo
}

func NewTransferenciaEntreCuentasService(pool *pgxpool.Pool, operationRepo *repositories.OperationRepo, auditRepo *repositories.AuditRepo) *TransferenciaEntreCuentasService {
	return &TransferenciaEntreCuentasService{pool: pool, operationRepo: operationRepo, auditRepo: auditRepo}
}

type TransferenciaEntreCuentasFrom struct {
	AccountID  string `json:"account_id"`
	CurrencyID string `json:"currency_id"`
	Format     string `json:"format"`
	Amount     string `json:"amount"`
}

type TransferenciaEntreCuentasTo struct {
	AccountID string `json:"account_id"`
	Format    string `json:"format"`
}

type TransferenciaEntreCuentasInput struct {
	From TransferenciaEntreCuentasFrom `json:"from"`
	To   TransferenciaEntreCuentasTo   `json:"to"`
}

func (s *TransferenciaEntreCuentasService) Execute(ctx context.Context, movementID string, input TransferenciaEntreCuentasInput, callerID string) error {
	if input.From.AccountID == input.To.AccountID {
		return ErrSameAccount
	}

	amt, ok := new(big.Rat).SetString(input.From.Amount)
	if !ok || amt.Sign() <= 0 {
		return ErrInvalidAmount
	}

	if input.From.Format != "CASH" && input.From.Format != "DIGITAL" {
		return ErrInvalidAmount
	}
	if input.To.Format != "CASH" && input.To.Format != "DIGITAL" {
		return ErrInvalidAmount
	}

	if err := s.operationRepo.ValidateAccountCurrencyFormat(ctx, input.From.AccountID, input.From.CurrencyID, input.From.Format); err != nil {
		return err
	}
	if err := s.operationRepo.ValidateAccountCurrencyFormat(ctx, input.To.AccountID, input.From.CurrencyID, input.To.Format); err != nil {
		return err
	}

	var movType, movStatus string
	err := s.pool.QueryRow(ctx,
		`SELECT type, status FROM movements WHERE id = $1`, movementID).Scan(&movType, &movStatus)
	if err != nil {
		return ErrMovementNotFound
	}
	if movType != "TRANSFERENCIA_ENTRE_CUENTAS" {
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
		input.From.AccountID, input.From.CurrencyID, input.From.Format, input.From.Amount, false)
	if err != nil {
		return fmt.Errorf("insert OUT line: %w", err)
	}

	_, err = s.operationRepo.InsertMovementLine(ctx, tx, movementID, "IN",
		input.To.AccountID, input.From.CurrencyID, input.To.Format, input.From.Amount, false)
	if err != nil {
		return fmt.Errorf("insert IN line: %w", err)
	}

	if err := s.auditRepo.InsertTx(ctx, tx, "movement", &movementID, "transferencia_entre_cuentas",
		nil,
		map[string]interface{}{
			"from_account": input.From.AccountID,
			"to_account":   input.To.AccountID,
			"currency":     input.From.CurrencyID,
			"amount":       input.From.Amount,
		},
		callerID); err != nil {
		return fmt.Errorf("insert transferencia_entre_cuentas audit: %w", err)
	}

	if err := confirmMovementDraftTx(ctx, tx, s.pool, s.operationRepo, s.auditRepo, movementID, callerID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}
