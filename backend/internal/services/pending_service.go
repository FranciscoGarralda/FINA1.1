package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"

	"fina/internal/repositories"

	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrPendingAlreadyResolved       = errors.New("PENDING_ALREADY_RESOLVED")
	ErrInvalidResolveAmount         = errors.New("INVALID_RESOLVE_AMOUNT")
	ErrPartialNotAllowed            = errors.New("PARTIAL_NOT_ALLOWED")
	ErrInvalidResolveMode           = errors.New("INVALID_RESOLVE_MODE")
	ErrCompensationOnlyForCC        = errors.New("COMPENSATION_ONLY_FOR_CC")
	ErrCompensatedRequiresRef       = errors.New("COMPENSATED_REQUIRES_MOVEMENT_ID")
	ErrCompensatedPartialNotAllowed = errors.New("COMPENSATED_PARTIAL_NOT_ALLOWED")
)

type PendingService struct {
	pool          *pgxpool.Pool
	pendingRepo   *repositories.PendingRepo
	operationRepo *repositories.OperationRepo
	settingsRepo  *repositories.SettingsRepo
	auditRepo     *repositories.AuditRepo
}

func NewPendingService(
	pool *pgxpool.Pool,
	pendingRepo *repositories.PendingRepo,
	settingsRepo *repositories.SettingsRepo,
	auditRepo *repositories.AuditRepo,
) *PendingService {
	return &PendingService{
		pool:          pool,
		pendingRepo:   pendingRepo,
		operationRepo: repositories.NewOperationRepo(pool),
		settingsRepo:  settingsRepo,
		auditRepo:     auditRepo,
	}
}

func (s *PendingService) List(ctx context.Context) ([]repositories.PendingListItem, error) {
	return s.pendingRepo.ListOpen(ctx)
}

type ResolveInput struct {
	AccountID            string `json:"account_id"`
	Format               string `json:"format"`
	Amount               string `json:"amount"`
	Mode                 string `json:"mode"` // REAL_EXECUTION | COMPENSATED
	ResolvedByMovementID string `json:"resolved_by_movement_id"`
	ResolutionNote       string `json:"resolution_note"`
}

func (s *PendingService) Resolve(ctx context.Context, pendingID string, input ResolveInput, callerID string) error {
	pending, err := s.pendingRepo.FindByID(ctx, pendingID)
	if err != nil {
		return err
	}
	if pending.Status != "ABIERTO" {
		return ErrPendingAlreadyResolved
	}

	mode := input.Mode
	if mode == "" {
		mode = "REAL_EXECUTION"
	}
	if mode != "REAL_EXECUTION" && mode != "COMPENSATED" {
		return ErrInvalidResolveMode
	}

	resolveAmt, ok := new(big.Rat).SetString(input.Amount)
	if !ok || resolveAmt.Sign() <= 0 {
		return ErrInvalidResolveAmount
	}
	pendingAmt, _ := new(big.Rat).SetString(pending.Amount)
	if resolveAmt.Cmp(pendingAmt) > 0 {
		return ErrInvalidResolveAmount
	}

	isPartial := resolveAmt.Cmp(pendingAmt) < 0
	if isPartial {
		allowed, _ := s.getSettingBool(ctx, "pending_allow_partial_resolution")
		if !allowed {
			return ErrPartialNotAllowed
		}
	}

	if mode == "REAL_EXECUTION" {
		if input.Format != "CASH" && input.Format != "DIGITAL" {
			return ErrInvalidResolveAmount
		}
		if err := s.operationRepo.ValidateAccountCurrencyFormat(ctx, input.AccountID, pending.CurrencyID, input.Format); err != nil {
			return err
		}
	}

	side := "IN"
	if pending.Type == "PENDIENTE_DE_PAGO" || pending.Type == "PENDIENTE_DE_PAGO_COMISION" {
		side = "OUT"
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if mode == "COMPENSATED" {
		if !pending.CcEnabled {
			return ErrCompensationOnlyForCC
		}
		if resolveAmt.Cmp(pendingAmt) != 0 {
			return ErrCompensatedPartialNotAllowed
		}
		ref := input.ResolvedByMovementID
		if ref == "" {
			return ErrCompensatedRequiresRef
		}
		note := input.ResolutionNote
		if err := s.pendingRepo.MarkResolvedWithMode(ctx, tx, pendingID, callerID, "COMPENSATED", &ref, &note); err != nil {
			return fmt.Errorf("mark compensated: %w", err)
		}
		beforeJSON := map[string]interface{}{
			"status": pending.Status,
			"amount": pending.Amount,
		}
		afterJSON := map[string]interface{}{
			"status":                  "RESUELTO",
			"resolution_mode":         "COMPENSATED",
			"resolved_by_movement_id": ref,
			"resolver_id":             callerID,
		}
		if note != "" {
			afterJSON["resolution_note"] = note
		}
		if err := s.auditRepo.InsertTx(ctx, tx, "pending", &pendingID, "resolve_compensated", beforeJSON, afterJSON, callerID); err != nil {
			return fmt.Errorf("insert resolve_compensated audit: %w", err)
		}
		return tx.Commit(ctx)
	}
	// 1) Create real movement_line
	_, err = s.pendingRepo.InsertMovementLine(ctx, tx,
		pending.MovementID, side, input.AccountID,
		pending.CurrencyID, input.Format, input.Amount)
	if err != nil {
		return fmt.Errorf("insert movement_line: %w", err)
	}

	beforeJSON := map[string]interface{}{
		"status": pending.Status,
		"amount": pending.Amount,
	}

	// 2) Update pending status/amount
	if isPartial {
		if err := s.pendingRepo.ReduceAmount(ctx, tx, pendingID, input.Amount); err != nil {
			return fmt.Errorf("reduce amount: %w", err)
		}
		afterJSON := map[string]interface{}{
			"status":          "ABIERTO",
			"amount_resolved": input.Amount,
			"resolver_id":     callerID,
		}
		if err := s.auditRepo.InsertTx(ctx, tx, "pending", &pendingID, "resolve_partial", beforeJSON, afterJSON, callerID); err != nil {
			return fmt.Errorf("insert resolve_partial audit: %w", err)
		}
	} else {
		if err := s.pendingRepo.MarkResolvedWithMode(ctx, tx, pendingID, callerID, "REAL_EXECUTION", nil, nil); err != nil {
			return fmt.Errorf("mark resolved: %w", err)
		}
		afterJSON := map[string]interface{}{
			"status":          "RESUELTO",
			"amount_resolved": input.Amount,
			"resolver_id":     callerID,
			"resolution_mode": "REAL_EXECUTION",
		}
		if err := s.auditRepo.InsertTx(ctx, tx, "pending", &pendingID, "resolve", beforeJSON, afterJSON, callerID); err != nil {
			return fmt.Errorf("insert resolve audit: %w", err)
		}
	}

	return tx.Commit(ctx)
}

func (s *PendingService) Cancel(ctx context.Context, pendingID string, callerID string) error {
	pending, err := s.pendingRepo.FindByID(ctx, pendingID)
	if err != nil {
		return err
	}
	if pending.Status != "ABIERTO" {
		return ErrPendingAlreadyResolved
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if err := s.pendingRepo.MarkCancelled(ctx, tx, pendingID, callerID); err != nil {
		return err
	}

	beforeJSON := map[string]interface{}{
		"status": pending.Status,
		"amount": pending.Amount,
	}
	afterJSON := map[string]interface{}{
		"status": "CANCELADO",
	}
	if err := s.auditRepo.InsertTx(ctx, tx, "pending", &pendingID, "cancel", beforeJSON, afterJSON, callerID); err != nil {
		return fmt.Errorf("insert cancel audit: %w", err)
	}

	return tx.Commit(ctx)
}

func (s *PendingService) getSettingBool(ctx context.Context, key string) (bool, error) {
	all, err := s.settingsRepo.GetAll(ctx)
	if err != nil {
		return false, err
	}
	raw, ok := all[key]
	if !ok {
		var v bool
		json.Unmarshal([]byte("true"), &v)
		return v, nil
	}
	var v bool
	if err := json.Unmarshal(raw, &v); err != nil {
		return true, nil
	}
	return v, nil
}
