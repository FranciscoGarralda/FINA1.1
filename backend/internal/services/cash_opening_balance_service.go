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

const MovementTypeSaldoInicialCaja = "SALDO_INICIAL_CAJA"

const maxCashOpeningBalanceLines = 200

var (
	ErrOpeningBalanceNoLines       = errors.New("OPENING_BALANCE_NO_LINES")
	ErrDuplicateOpeningBalanceLine = errors.New("DUPLICATE_OPENING_BALANCE_LINE")
	ErrOpeningBalanceTooManyLines  = errors.New("OPENING_BALANCE_TOO_MANY_LINES")
	ErrCashOpeningBalanceDate      = errors.New("INVALID_CASH_OPENING_DATE")
)

// CashOpeningBalanceLineInput una línea IN de saldo inicial (cuenta real, sin pendiente).
type CashOpeningBalanceLineInput struct {
	AccountID  string `json:"account_id"`
	CurrencyID string `json:"currency_id"`
	Format     string `json:"format"`
	Amount     string `json:"amount"`
}

// CashOpeningBalanceInput cuerpo de POST /api/movements/saldo-inicial-caja.
type CashOpeningBalanceInput struct {
	Date  string                        `json:"date"`
	Note  *string                       `json:"note,omitempty"`
	Lines []CashOpeningBalanceLineInput `json:"lines"`
}

type CashOpeningBalanceResult struct {
	MovementID      string `json:"movement_id"`
	OperationNumber int64  `json:"operation_number"`
}

type CashOpeningBalanceService struct {
	pool          *pgxpool.Pool
	operationRepo *repositories.OperationRepo
	auditRepo     *repositories.AuditRepo
}

func NewCashOpeningBalanceService(pool *pgxpool.Pool, operationRepo *repositories.OperationRepo, auditRepo *repositories.AuditRepo) *CashOpeningBalanceService {
	return &CashOpeningBalanceService{
		pool:          pool,
		operationRepo: operationRepo,
		auditRepo:     auditRepo,
	}
}

// Create registra movimiento SALDO_INICIAL_CAJA + líneas IN confirmadas (sin CC ni pending_items), en una transacción.
func (s *CashOpeningBalanceService) Create(ctx context.Context, input CashOpeningBalanceInput, callerID string) (*CashOpeningBalanceResult, error) {
	if len(input.Lines) == 0 {
		return nil, ErrOpeningBalanceNoLines
	}
	if len(input.Lines) > maxCashOpeningBalanceLines {
		return nil, ErrOpeningBalanceTooManyLines
	}

	seen := make(map[string]struct{}, len(input.Lines))
	normalized := make([]CashOpeningBalanceLineInput, 0, len(input.Lines))
	for _, raw := range input.Lines {
		accountID := strings.TrimSpace(raw.AccountID)
		currencyID := strings.TrimSpace(raw.CurrencyID)
		format := strings.ToUpper(strings.TrimSpace(raw.Format))
		amountStr := strings.TrimSpace(raw.Amount)
		if accountID == "" || currencyID == "" {
			return nil, ErrInvalidAmount
		}
		if format != "CASH" && format != "DIGITAL" {
			return nil, ErrInvalidAmount
		}
		amt, ok := new(big.Rat).SetString(amountStr)
		if !ok || amt.Sign() <= 0 {
			return nil, ErrInvalidAmount
		}
		key := accountID + "|" + currencyID + "|" + format
		if _, dup := seen[key]; dup {
			return nil, ErrDuplicateOpeningBalanceLine
		}
		seen[key] = struct{}{}
		normalized = append(normalized, CashOpeningBalanceLineInput{
			AccountID:  accountID,
			CurrencyID: currencyID,
			Format:     format,
			Amount:     amountStr,
		})
	}

	dateStr := strings.TrimSpace(input.Date)
	if dateStr == "" {
		dateStr = time.Now().UTC().Format("2006-01-02")
	}
	dayName, err := MovementDayNameES(dateStr)
	if err != nil {
		return nil, ErrCashOpeningBalanceDate
	}

	for _, line := range normalized {
		if err := s.operationRepo.ValidateAccountCurrencyFormat(ctx, line.AccountID, line.CurrencyID, line.Format); err != nil {
			return nil, err
		}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	header, err := s.operationRepo.CreateMovementHeader(ctx, tx, MovementTypeSaldoInicialCaja, dateStr, dayName, nil, callerID)
	if err != nil {
		return nil, fmt.Errorf("create header: %w", err)
	}
	movementID := header.ID

	if input.Note != nil && strings.TrimSpace(*input.Note) != "" {
		if err := s.operationRepo.UpdateMovementNoteTx(ctx, tx, movementID, input.Note); err != nil {
			return nil, fmt.Errorf("update note: %w", err)
		}
	}

	linesAudit := make([]map[string]interface{}, 0, len(normalized))
	for _, line := range normalized {
		if _, err := s.operationRepo.InsertMovementLine(ctx, tx, movementID, "IN",
			line.AccountID, line.CurrencyID, line.Format, line.Amount, false); err != nil {
			return nil, fmt.Errorf("insert line: %w", err)
		}
		linesAudit = append(linesAudit, map[string]interface{}{
			"account_id":  line.AccountID,
			"currency_id": line.CurrencyID,
			"format":      line.Format,
			"amount":      line.Amount,
		})
	}

	if err := s.auditRepo.InsertTx(ctx, tx, "movement", &movementID, "saldo_inicial_caja",
		nil,
		map[string]interface{}{
			"date":               dateStr,
			"lines":              linesAudit,
			"operation_number":   header.OperationNumber,
			"lines_count":        len(normalized),
		},
		callerID); err != nil {
		return nil, fmt.Errorf("audit saldo_inicial_caja: %w", err)
	}

	if err := confirmMovementDraftTx(ctx, tx, s.pool, s.operationRepo, s.auditRepo, movementID, callerID); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}

	return &CashOpeningBalanceResult{
		MovementID:      movementID,
		OperationNumber: header.OperationNumber,
	}, nil
}
