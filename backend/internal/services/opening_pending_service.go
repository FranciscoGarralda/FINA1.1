package services

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"fina/internal/repositories"

	"github.com/jackc/pgx/v5/pgxpool"
)

const MovementTypePendienteInicial = "PENDIENTE_INICIAL"

var (
	ErrInvalidOpeningPendingKind = errors.New("INVALID_OPENING_PENDING_KIND")
	ErrOpeningPendingDate        = errors.New("INVALID_OPENING_PENDING_DATE")
)

// OpeningPendingInput alta de pendiente de apertura (sin CC, sin profit).
type OpeningPendingInput struct {
	ClientID    string  `json:"client_id"`
	PendingKind string  `json:"pending_kind"` // RETIRO | PAGO
	AccountID   string  `json:"account_id"`
	CurrencyID  string  `json:"currency_id"`
	Format      string  `json:"format"`
	Amount      string  `json:"amount"`
	Date        string  `json:"date,omitempty"`
	Note        *string `json:"note,omitempty"`
}

type OpeningPendingResult struct {
	MovementID      string `json:"movement_id"`
	PendingItemID   string `json:"pending_item_id"`
	OperationNumber int64  `json:"operation_number"`
}

type OpeningPendingService struct {
	pool          *pgxpool.Pool
	operationRepo *repositories.OperationRepo
	auditRepo     *repositories.AuditRepo
}

func NewOpeningPendingService(pool *pgxpool.Pool, operationRepo *repositories.OperationRepo, auditRepo *repositories.AuditRepo) *OpeningPendingService {
	return &OpeningPendingService{
		pool:          pool,
		operationRepo: operationRepo,
		auditRepo:     auditRepo,
	}
}

// Create registra movimiento PENDIENTE_INICIAL + línea pendiente + pending_items en una transacción (sin CC).
func (s *OpeningPendingService) Create(ctx context.Context, input OpeningPendingInput, callerID string) (*OpeningPendingResult, error) {
	clientID := strings.TrimSpace(input.ClientID)
	if clientID == "" {
		return nil, ErrClientRequired
	}
	kind := strings.ToUpper(strings.TrimSpace(input.PendingKind))
	var side string
	var pendingType string
	switch kind {
	case "RETIRO":
		side = "OUT"
		pendingType = "PENDIENTE_DE_RETIRO"
	case "PAGO":
		side = "IN"
		pendingType = "PENDIENTE_DE_PAGO"
	default:
		return nil, ErrInvalidOpeningPendingKind
	}

	amt, ok := new(big.Rat).SetString(strings.TrimSpace(input.Amount))
	if !ok || amt.Sign() <= 0 {
		return nil, ErrInvalidAmount
	}
	amountStr := strings.TrimSpace(input.Amount)
	if input.Format != "CASH" && input.Format != "DIGITAL" {
		return nil, ErrInvalidAmount
	}

	dateStr := strings.TrimSpace(input.Date)
	if dateStr == "" {
		dateStr = time.Now().UTC().Format("2006-01-02")
	}
	dayName, err := MovementDayNameES(dateStr)
	if err != nil {
		return nil, ErrOpeningPendingDate
	}

	if err := s.operationRepo.ValidateClientActive(ctx, clientID); err != nil {
		return nil, err
	}
	if err := s.operationRepo.ValidateAccountCurrencyFormat(ctx, input.AccountID, input.CurrencyID, input.Format); err != nil {
		return nil, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	clientPtr := &clientID
	header, err := s.operationRepo.CreateMovementHeader(ctx, tx, MovementTypePendienteInicial, dateStr, dayName, clientPtr, callerID)
	if err != nil {
		return nil, fmt.Errorf("create header: %w", err)
	}
	movementID := header.ID

	if input.Note != nil && strings.TrimSpace(*input.Note) != "" {
		if err := s.operationRepo.UpdateMovementNoteTx(ctx, tx, movementID, input.Note); err != nil {
			return nil, fmt.Errorf("update note: %w", err)
		}
	}

	lineID, err := s.operationRepo.InsertMovementLine(ctx, tx, movementID, side,
		input.AccountID, input.CurrencyID, input.Format, amountStr, true)
	if err != nil {
		return nil, fmt.Errorf("insert line: %w", err)
	}

	pendingID, err := s.operationRepo.InsertPendingItem(ctx, tx, lineID, pendingType, clientID, input.CurrencyID, amountStr)
	if err != nil {
		return nil, fmt.Errorf("insert pending: %w", err)
	}

	if err := s.auditRepo.InsertTx(ctx, tx, "movement", &movementID, "pending_opening",
		nil,
		map[string]interface{}{
			"pending_kind":      kind,
			"pending_type":      pendingType,
			"side":              side,
			"client_id":         clientID,
			"account_id":        input.AccountID,
			"currency_id":       input.CurrencyID,
			"format":            input.Format,
			"amount":            amountStr,
			"date":              dateStr,
			"pending_item_id":   pendingID,
			"operation_number":  header.OperationNumber,
		},
		callerID); err != nil {
		return nil, fmt.Errorf("audit pending_opening: %w", err)
	}

	if err := confirmMovementDraftTx(ctx, tx, s.pool, s.operationRepo, s.auditRepo, movementID, callerID); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}

	return &OpeningPendingResult{
		MovementID:      movementID,
		PendingItemID:   pendingID,
		OperationNumber: header.OperationNumber,
	}, nil
}
