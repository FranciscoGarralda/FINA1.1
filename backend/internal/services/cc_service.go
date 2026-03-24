package services

import (
	"context"
	"errors"
	"fmt"
	"time"

	"fina/internal/repositories"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrCCNotEnabledForClient se devuelve si se intenta aplicar un asiento CC a un cliente con cc_enabled=false.
var ErrCCNotEnabledForClient = errors.New("CC_NOT_ENABLED_FOR_CLIENT")

type CCService struct {
	pool      *pgxpool.Pool
	ccRepo    *repositories.CCRepo
	auditRepo *repositories.AuditRepo
}

func NewCCService(pool *pgxpool.Pool, ccRepo *repositories.CCRepo, auditRepo *repositories.AuditRepo) *CCService {
	return &CCService{pool: pool, ccRepo: ccRepo, auditRepo: auditRepo}
}

type ApplyCCEntryInput struct {
	ClientID   string
	CurrencyID string
	Amount     string
	MovementID string
	Note       *string
}

// ApplyEntry creates a cc_entry and atomically updates cc_balances within a transaction.
// The signed amount is applied as-is (negative = increase debt, positive = reduce debt).
func (s *CCService) ApplyEntry(ctx context.Context, tx pgx.Tx, input ApplyCCEntryInput, callerID string) (string, error) {
	var ccEnabled bool
	err := tx.QueryRow(ctx,
		`SELECT COALESCE(cc_enabled, false) FROM clients WHERE id = $1::uuid`,
		input.ClientID,
	).Scan(&ccEnabled)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", fmt.Errorf("cliente no encontrado para CC: %w", err)
		}
		return "", err
	}
	if !ccEnabled {
		return "", ErrCCNotEnabledForClient
	}

	newBalance, err := s.ccRepo.ApplyCCEntry(ctx, tx, input.ClientID, input.CurrencyID, input.Amount, input.MovementID, input.Note)
	if err != nil {
		return "", err
	}

	entryID := input.MovementID
	s.auditRepo.Insert(ctx, "cc_entry", &entryID, "create",
		nil,
		map[string]interface{}{
			"client_id":   input.ClientID,
			"currency_id": input.CurrencyID,
			"amount":      input.Amount,
			"movement_id": input.MovementID,
			"new_balance": newBalance,
		},
		callerID)

	return newBalance, nil
}

func (s *CCService) GetBalances(ctx context.Context) ([]repositories.CCBalanceSummary, error) {
	return s.ccRepo.ListBalances(ctx)
}

func (s *CCService) GetClientBalances(ctx context.Context, clientID string) ([]repositories.CCCurrencyBalance, error) {
	return s.ccRepo.GetClientBalances(ctx, clientID)
}

func (s *CCService) GetEntries(ctx context.Context, clientID, currencyID string) ([]repositories.CCEntryItem, error) {
	return s.ccRepo.ListEntries(ctx, clientID, currencyID)
}

func (s *CCService) GetClientCodeForExport(ctx context.Context, clientID string) (int64, error) {
	return s.ccRepo.GetClientCodeForExport(ctx, clientID)
}

func (s *CCService) ListEntriesForExport(ctx context.Context, clientID string, fromDate, toDate time.Time) ([]repositories.CCEntryExportRow, error) {
	return s.ccRepo.ListEntriesForExport(ctx, clientID, fromDate, toDate)
}
