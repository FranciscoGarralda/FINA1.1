package services

import (
	"context"
	"errors"
	"fmt"

	"fina/internal/repositories"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	MovementStatusDraft     = "BORRADOR"
	MovementStatusConfirmed = "CONFIRMADA"
	MovementStatusCancelled = "CANCELADA"
)

var ErrMovementNotDraft = errors.New("MOVEMENT_NOT_DRAFT")

func confirmMovementDraftTx(ctx context.Context, tx pgx.Tx, pool *pgxpool.Pool, opRepo *repositories.OperationRepo, auditRepo *repositories.AuditRepo, movementID, callerID string) error {
	correction, err := opRepo.GetMovementCorrectionByDraftTx(ctx, tx, movementID)
	if err != nil {
		return err
	}
	if correction != nil && correction.Status == "PENDING" {
		if correction.Mode == CorrectionModeModify {
			ccRepo := repositories.NewCCRepo(pool)
			if err := cancelMovementWithinTx(ctx, tx, opRepo, ccRepo, auditRepo, correction.SourceMovementID, callerID); err != nil {
				return err
			}
		}
	}

	updated, err := opRepo.TransitionMovementStatusTx(ctx, tx, movementID, MovementStatusDraft, MovementStatusConfirmed)
	if err != nil {
		return err
	}
	if !updated {
		return ErrMovementNotDraft
	}

	if err := auditRepo.InsertTx(ctx, tx, "movement", &movementID, "confirm",
		map[string]interface{}{"status": MovementStatusDraft},
		map[string]interface{}{"status": MovementStatusConfirmed},
		callerID); err != nil {
		return err
	}
	if correction != nil && correction.Status == "PENDING" {
		if err := opRepo.MarkMovementCorrectionAppliedTx(ctx, tx, movementID); err != nil {
			return err
		}
		if err := auditRepo.InsertTx(ctx, tx, "movement", &movementID, "confirm_correction",
			nil,
			map[string]interface{}{
				"mode":                  correction.Mode,
				"source_movement_id":    correction.SourceMovementID,
				"corrected_movement_id": correction.DraftMovementID,
			},
			callerID); err != nil {
			return err
		}
	}
	if fxInventoryMovementHook != nil {
		if err := fxInventoryMovementHook.ApplyOnMovementConfirmed(ctx, tx, movementID); err != nil {
			return err
		}
	}
	return nil
}

func cancelMovementWithinTx(ctx context.Context, tx pgx.Tx, opRepo *repositories.OperationRepo, ccRepo *repositories.CCRepo, auditRepo *repositories.AuditRepo, movementID, callerID string) error {
	meta, err := opRepo.GetMovementMetaTx(ctx, tx, movementID)
	if err != nil {
		return err
	}
	switch meta.Status {
	case MovementStatusCancelled:
		return ErrMovementAlreadyCancelled
	case MovementStatusConfirmed:
		// ok
	default:
		return ErrMovementNotConfirmed
	}

	lines, err := opRepo.ListMovementLinesTx(ctx, tx, movementID)
	if err != nil {
		return fmt.Errorf("list movement lines: %w", err)
	}

	createdReversalLines := 0
	for _, line := range lines {
		if line.IsPending {
			continue
		}
		reversedSide, err := repositories.ReverseSide(line.Side)
		if err != nil {
			return err
		}
		if _, err := opRepo.InsertMovementLine(ctx, tx, movementID, reversedSide, line.AccountID, line.CurrencyID, line.Format, line.Amount, false); err != nil {
			return fmt.Errorf("insert reversal movement line: %w", err)
		}
		createdReversalLines++
	}

	ccEntries, err := opRepo.ListMovementCCEntriesTx(ctx, tx, movementID)
	if err != nil {
		return fmt.Errorf("list movement cc entries: %w", err)
	}
	createdReversalCCEntries := 0
	for _, entry := range ccEntries {
		reversedAmount, err := reverseSignedAmount(entry.Amount)
		if err != nil {
			return err
		}
		note := "Anulación de operación"
		if entry.Note != nil && *entry.Note != "" {
			note = "Reversa: " + *entry.Note
		}
		if _, err := ccRepo.ApplyCCEntry(ctx, tx, entry.ClientID, entry.CurrencyID, reversedAmount, movementID, &note); err != nil {
			return fmt.Errorf("insert reversal cc entry: %w", err)
		}
		createdReversalCCEntries++
	}

	profitEntries, err := opRepo.ListMovementProfitEntriesTx(ctx, tx, movementID)
	if err != nil {
		return fmt.Errorf("list movement profit entries: %w", err)
	}
	createdReversalProfitEntries := 0
	for _, pe := range profitEntries {
		reversedAmount, err := reverseSignedAmount(pe.Amount)
		if err != nil {
			return err
		}
		if _, err := opRepo.InsertProfitEntry(ctx, tx, movementID, pe.CurrencyID, reversedAmount, pe.AccountID, pe.Format); err != nil {
			return fmt.Errorf("insert reversal profit entry: %w", err)
		}
		createdReversalProfitEntries++
	}

	if fxInventoryMovementHook != nil {
		if err := fxInventoryMovementHook.ReverseOnMovementCancelled(ctx, tx, movementID); err != nil {
			return fmt.Errorf("fx inventory reverse: %w", err)
		}
	}

	cancelledPendingCount, err := opRepo.CancelPendingItemsByMovementTx(ctx, tx, movementID, callerID)
	if err != nil {
		return fmt.Errorf("cancel pending items by movement: %w", err)
	}

	updated, err := opRepo.TransitionMovementStatusTx(ctx, tx, movementID, MovementStatusConfirmed, MovementStatusCancelled)
	if err != nil {
		return err
	}
	if !updated {
		return ErrMovementNotConfirmed
	}

	before := map[string]interface{}{
		"status": meta.Status,
	}
	after := map[string]interface{}{
		"status":                        MovementStatusCancelled,
		"reversal_movement_lines":       createdReversalLines,
		"reversal_cc_entries":           createdReversalCCEntries,
		"reversal_profit_entries":       createdReversalProfitEntries,
		"cancelled_pending_items_count": cancelledPendingCount,
	}
	if err := auditRepo.InsertTx(ctx, tx, "movement", &movementID, "cancel_operation", before, after, callerID); err != nil {
		return fmt.Errorf("insert cancel_operation audit: %w", err)
	}

	if err := validateZeroNetByMovementTx(ctx, tx, movementID); err != nil {
		return err
	}
	return nil
}
