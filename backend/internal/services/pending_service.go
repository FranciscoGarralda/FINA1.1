package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strings"

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
	ErrResolveAccountMismatch       = errors.New("RESOLVE_ACCOUNT_MISMATCH")
	ErrInvalidMovementLineSide      = errors.New("INVALID_MOVEMENT_LINE_SIDE")
)

// validatePendingResolvePreTx valida reglas de negocio antes de abrir transacción
// (parcial, formato REAL, reglas COMPENSATED). Los importes ya deben ser coherentes con pending.Amount.
func validatePendingResolvePreTx(
	p *repositories.PendingDetail,
	input ResolveInput,
	mode string,
	resolveAmt, pendingAmt *big.Rat,
	isPartial, partialAllowed bool,
) error {
	if isPartial && !partialAllowed {
		return ErrPartialNotAllowed
	}
	if mode == "REAL_EXECUTION" {
		if input.Format != "CASH" && input.Format != "DIGITAL" {
			return ErrInvalidResolveAmount
		}
	}
	if mode == "COMPENSATED" {
		if !p.CcEnabled {
			return ErrCompensationOnlyForCC
		}
		if resolveAmt.Cmp(pendingAmt) != 0 {
			return ErrCompensatedPartialNotAllowed
		}
		if input.ResolvedByMovementID == "" {
			return ErrCompensatedRequiresRef
		}
	}
	return nil
}

func validatePendingCancelable(p *repositories.PendingDetail) error {
	if p.Status != "ABIERTO" {
		return ErrPendingAlreadyResolved
	}
	return nil
}

// validateResolveRealExecutionLine exige mismo account y side IN/OUT que la línea origen del pendiente.
func validateResolveRealExecutionLine(p *repositories.PendingDetail, input ResolveInput) error {
	side := strings.TrimSpace(p.MovementLineSide)
	if side != "IN" && side != "OUT" {
		return ErrInvalidMovementLineSide
	}
	if strings.TrimSpace(input.AccountID) != strings.TrimSpace(p.MovementLineAccountID) {
		return ErrResolveAccountMismatch
	}
	return nil
}

type PendingService struct {
	pool          *pgxpool.Pool
	pendingRepo   *repositories.PendingRepo
	operationRepo *repositories.OperationRepo
	settingsRepo  *repositories.SettingsRepo
	auditRepo     *repositories.AuditRepo
	ccSvc         *CCService
}

func NewPendingService(
	pool *pgxpool.Pool,
	pendingRepo *repositories.PendingRepo,
	settingsRepo *repositories.SettingsRepo,
	auditRepo *repositories.AuditRepo,
	ccSvc *CCService,
) *PendingService {
	return &PendingService{
		pool:          pool,
		pendingRepo:   pendingRepo,
		operationRepo: repositories.NewOperationRepo(pool),
		settingsRepo:  settingsRepo,
		auditRepo:     auditRepo,
		ccSvc:         ccSvc,
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
	pendingAmt, ok := new(big.Rat).SetString(pending.Amount)
	if !ok {
		return ErrInvalidResolveAmount
	}
	if resolveAmt.Cmp(pendingAmt) > 0 {
		return ErrInvalidResolveAmount
	}

	isPartial := resolveAmt.Cmp(pendingAmt) < 0
	partialAllowed := true
	if isPartial {
		allowed, err := s.getSettingBool(ctx, "pending_allow_partial_resolution")
		if err != nil {
			return err
		}
		partialAllowed = allowed
	}

	if err := validatePendingResolvePreTx(pending, input, mode, resolveAmt, pendingAmt, isPartial, partialAllowed); err != nil {
		return err
	}

	side := strings.TrimSpace(pending.MovementLineSide)
	if mode == "REAL_EXECUTION" {
		if err := validateResolveRealExecutionLine(pending, input); err != nil {
			return err
		}
		if err := s.operationRepo.ValidateAccountCurrencyFormat(ctx, input.AccountID, pending.CurrencyID, input.Format); err != nil {
			return err
		}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if mode == "COMPENSATED" {
		ref := input.ResolvedByMovementID
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
	// 1) REAL_EXECUTION — líneas del movimiento:
	//    Total: actualizar la misma movement_line (sin segunda fila que duplique SUM).
	//    Parcial: restar el monto ejecutado de la línea pendiente + insertar solo la parte ejecutada (SUM estable).
	if isPartial {
		if err := s.pendingRepo.SubtractResolvedAmountFromPendingMovementLine(ctx, tx,
			pending.MovementID, pending.MovementLineID, input.Amount); err != nil {
			return fmt.Errorf("subtract from pending movement_line: %w", err)
		}
		_, err = s.pendingRepo.InsertMovementLine(ctx, tx,
			pending.MovementID, side, input.AccountID,
			pending.CurrencyID, input.Format, input.Amount)
		if err != nil {
			return fmt.Errorf("insert movement_line: %w", err)
		}
	} else {
		if err := s.pendingRepo.ApplyRealExecutionToMovementLine(ctx, tx,
			pending.MovementID, pending.MovementLineID,
			input.AccountID, input.Format, input.Amount); err != nil {
			return fmt.Errorf("apply real execution to movement_line: %w", err)
		}
	}

	// CC diferida: solo si al confirmar se omitió CC para este pendiente (cc_apply_on_resolve).
	// Si el cliente deshabilitó CC después del alta, se completa la caja sin asiento CC (sin bloquear resolve).
	//
	// Regla de negocio (Regla #21): COMPENSATED no aplica impacto CC diferido, nunca.
	// Fundamento: COMPENSATED cierra el pendiente administrativamente referenciando otra operación
	// como contrapartida (resolved_by_movement_id). No hay ejecución de caja real, por lo tanto
	// no hay flujo de dinero que justifique un asiento CC. La responsabilidad CC quedó registrada
	// en la operación referenciada. Si en el futuro el negocio decide aplicar CC también en
	// COMPENSATED, crear ticket explícito — es cambio de regla, no corrección de bug.
	if pending.CcEnabled && pending.CcApplyOnResolve && s.ccSvc != nil {
		ccSide := strings.TrimSpace(pending.MovementLineSide)
		if ccSide != ccSideIn && ccSide != ccSideOut {
			return fmt.Errorf("pending cc resolve: %w", ErrInvalidMovementLineSide)
		}
		ccNote := "[CC-PEND-REAL] Liquidación pendiente — ejecución real"
		if err := applyCCImpactTx(ctx, s.ccSvc, tx, pending.ClientID, pending.CurrencyID, ratTrim(resolveAmt), pending.MovementID, ccSide, ccNote, callerID); err != nil {
			return fmt.Errorf("apply deferred cc on resolve: %w", err)
		}
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
	if err := validatePendingCancelable(pending); err != nil {
		return err
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
