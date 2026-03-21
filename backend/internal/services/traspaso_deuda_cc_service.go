package services

import (
	"context"
	"errors"
	"fmt"
	"math/big"

	"fina/internal/repositories"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrToClientRequired    = errors.New("TO_CLIENT_REQUIRED")
	ErrSameClientNotAllowed = errors.New("SAME_CLIENT_NOT_ALLOWED")
	ErrClientsMustBeCC     = errors.New("CLIENTS_MUST_BE_CC")
)

type TraspasoDeudaCCService struct {
	pool          *pgxpool.Pool
	operationRepo *repositories.OperationRepo
	ccSvc         *CCService
	auditRepo     *repositories.AuditRepo
}

func NewTraspasoDeudaCCService(pool *pgxpool.Pool, operationRepo *repositories.OperationRepo, ccSvc *CCService, auditRepo *repositories.AuditRepo) *TraspasoDeudaCCService {
	return &TraspasoDeudaCCService{pool: pool, operationRepo: operationRepo, ccSvc: ccSvc, auditRepo: auditRepo}
}

type TraspasoDeudaCCInput struct {
	ToClientID string  `json:"to_client_id"`
	CurrencyID string  `json:"currency_id"`
	Amount     string  `json:"amount"`
	Note       *string `json:"note,omitempty"`
}

func (s *TraspasoDeudaCCService) Execute(ctx context.Context, movementID string, input TraspasoDeudaCCInput, callerID string) error {
	if input.ToClientID == "" {
		return ErrToClientRequired
	}
	amt, ok := new(big.Rat).SetString(input.Amount)
	if !ok || amt.Sign() <= 0 {
		return ErrInvalidAmount
	}
	if input.CurrencyID == "" {
		return ErrInvalidAmount
	}

	var movType, movStatus, fromClientID string
	var fromActive, fromCCEnabled bool
	err := s.pool.QueryRow(ctx,
		`SELECT m.type, m.status, m.client_id::text, c.active, c.cc_enabled
		 FROM movements m
		 JOIN clients c ON c.id = m.client_id
		 WHERE m.id = $1`, movementID).
		Scan(&movType, &movStatus, &fromClientID, &fromActive, &fromCCEnabled)
	if err != nil {
		return ErrMovementNotFound
	}
	if movType != "TRASPASO_DEUDA_CC" {
		return ErrMovementTypeMismatch
	}
	if movStatus != MovementStatusDraft {
		return ErrMovementNotDraft
	}
	if !fromActive || !fromCCEnabled {
		return ErrClientsMustBeCC
	}
	if fromClientID == input.ToClientID {
		return ErrSameClientNotAllowed
	}

	var toActive, toCCEnabled bool
	err = s.pool.QueryRow(ctx, `SELECT active, cc_enabled FROM clients WHERE id = $1`, input.ToClientID).Scan(&toActive, &toCCEnabled)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return repositories.ErrNotFound
		}
		return err
	}
	if !toActive || !toCCEnabled {
		return ErrClientsMustBeCC
	}

	var currencyActive bool
	err = s.pool.QueryRow(ctx, `SELECT active FROM currencies WHERE id = $1`, input.CurrencyID).Scan(&currencyActive)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return repositories.ErrCurrencyNotEnabled
		}
		return err
	}
	if !currencyActive {
		return repositories.ErrCurrencyNotEnabled
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	note := "Traspaso deuda CC"
	if input.Note != nil && *input.Note != "" {
		note = *input.Note
	}

	// From client debt decreases => IN (positive)
	if err := applyCCImpactTx(ctx, s.ccSvc, tx, fromClientID, input.CurrencyID, input.Amount, movementID, ccSideIn, note, callerID); err != nil {
		return fmt.Errorf("insert from cc_entry: %w", err)
	}

	// To client debt increases => OUT (negative)
	if err := applyCCImpactTx(ctx, s.ccSvc, tx, input.ToClientID, input.CurrencyID, input.Amount, movementID, ccSideOut, note, callerID); err != nil {
		return fmt.Errorf("insert to cc_entry: %w", err)
	}

	if err := s.auditRepo.InsertTx(ctx, tx, "movement", &movementID, "traspaso_deuda_cc",
		nil,
		map[string]interface{}{
			"from_client_id": fromClientID,
			"to_client_id":   input.ToClientID,
			"currency_id":    input.CurrencyID,
			"amount":         input.Amount,
			"note":           input.Note,
		},
		callerID); err != nil {
		return fmt.Errorf("insert traspaso_deuda_cc audit: %w", err)
	}

	if err := confirmMovementDraftTx(ctx, tx, s.pool, s.operationRepo, s.auditRepo, movementID, callerID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}
