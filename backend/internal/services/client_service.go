package services

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"fina/internal/models"
	"fina/internal/repositories"

	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrClientFieldsRequired = errors.New("CLIENT_FIELDS_REQUIRED")
var ErrClientCCAdjustmentsRequireCC = errors.New("CLIENT_CC_ADJUSTMENTS_REQUIRE_CC")
var ErrClientCCDuplicateCurrency = errors.New("CLIENT_CC_DUPLICATE_CURRENCY")
var ErrClientCCAdjustmentAmountInvalid = errors.New("CLIENT_CC_ADJUSTMENT_AMOUNT_INVALID")

type ClientService struct {
	pool       *pgxpool.Pool
	clientRepo *repositories.ClientRepo
	auditRepo  *repositories.AuditRepo
}

func NewClientService(pool *pgxpool.Pool, cr *repositories.ClientRepo, ar *repositories.AuditRepo) *ClientService {
	return &ClientService{pool: pool, clientRepo: cr, auditRepo: ar}
}

func (s *ClientService) GetByID(ctx context.Context, id string) (*models.ClientDetail, error) {
	return s.clientRepo.FindByID(ctx, id)
}

func (s *ClientService) Create(ctx context.Context, input repositories.ClientInput, callerID string) (string, error) {
	if err := validateClientInput(&input); err != nil {
		return "", err
	}
	if err := validateCCAdjustmentsInput(input); err != nil {
		return "", err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	id, err := s.clientRepo.CreateTx(ctx, tx, input)
	if err != nil {
		return "", err
	}

	ccAdjustments := []repositories.CCBalanceAdjustmentResult{}
	if len(input.CcBalanceAdjustments) > 0 {
		ccAdjustments, err = s.clientRepo.ApplyCCBalanceAdjustmentsTx(ctx, tx, id, input.CcBalanceAdjustments, "OPENING_CC", callerID)
		if err != nil {
			return "", err
		}
	}

	if err := s.auditRepo.InsertTx(ctx, tx, "client", &id, "create",
		nil,
		map[string]interface{}{
			"first_name":             input.FirstName,
			"last_name":              input.LastName,
			"dni":                    input.DNI,
			"department":             input.Department,
			"cc_enabled":             input.CcEnabled,
			"cc_balance_adjustments": ccAdjustments,
		},
		callerID); err != nil {
		return "", err
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit tx: %w", err)
	}
	return id, nil
}

func (s *ClientService) Update(ctx context.Context, id string, input repositories.ClientInput, callerID string) error {
	if err := validateClientInput(&input); err != nil {
		return err
	}
	if err := validateCCAdjustmentsInput(input); err != nil {
		return err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	before, err := s.clientRepo.FindByIDTx(ctx, tx, id)
	if err != nil {
		return err
	}

	if err := s.clientRepo.UpdateTx(ctx, tx, id, input); err != nil {
		return err
	}

	ccAdjustments := []repositories.CCBalanceAdjustmentResult{}
	if len(input.CcBalanceAdjustments) > 0 {
		ccAdjustments, err = s.clientRepo.ApplyCCBalanceAdjustmentsTx(ctx, tx, id, input.CcBalanceAdjustments, "MANUAL_CC_ADJUSTMENT", callerID)
		if err != nil {
			return err
		}
	}

	if err := s.auditRepo.InsertTx(ctx, tx, "client", &id, "update",
		map[string]interface{}{
			"first_name":  before.FirstName,
			"last_name":   before.LastName,
			"department":  before.Department,
			"cc_enabled":  before.CcEnabled,
		},
		map[string]interface{}{
			"first_name":             input.FirstName,
			"last_name":              input.LastName,
			"department":             input.Department,
			"cc_enabled":             input.CcEnabled,
			"cc_balance_adjustments": ccAdjustments,
		},
		callerID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func validateClientInput(input *repositories.ClientInput) error {
	input.FirstName = strings.TrimSpace(input.FirstName)
	input.LastName = strings.TrimSpace(input.LastName)
	input.Phone = strings.TrimSpace(input.Phone)
	input.DNI = strings.TrimSpace(input.DNI)
	input.AddressStreet = strings.TrimSpace(input.AddressStreet)
	input.AddressNumber = strings.TrimSpace(input.AddressNumber)
	input.AddressFloor = strings.TrimSpace(input.AddressFloor)
	input.ReferenceContact = strings.TrimSpace(input.ReferenceContact)
	input.ReferredBy = strings.TrimSpace(input.ReferredBy)
	input.Department = strings.TrimSpace(input.Department)
	if utf8.RuneCountInString(input.Department) > 255 {
		rs := []rune(input.Department)
		input.Department = string(rs[:255])
	}

	if input.FirstName == "" || input.LastName == "" || input.Phone == "" ||
		input.DNI == "" || input.AddressStreet == "" || input.AddressNumber == "" ||
		input.AddressFloor == "" || input.ReferenceContact == "" || input.ReferredBy == "" {
		return ErrClientFieldsRequired
	}
	return nil
}

func validateCCAdjustmentsInput(input repositories.ClientInput) error {
	if len(input.CcBalanceAdjustments) == 0 {
		return nil
	}
	if !input.CcEnabled {
		return ErrClientCCAdjustmentsRequireCC
	}

	seenCurrency := make(map[string]struct{}, len(input.CcBalanceAdjustments))
	for _, adj := range input.CcBalanceAdjustments {
		currID := strings.TrimSpace(adj.CurrencyID)
		if currID == "" {
			return ErrClientCCAdjustmentAmountInvalid
		}
		if _, exists := seenCurrency[currID]; exists {
			return ErrClientCCDuplicateCurrency
		}
		seenCurrency[currID] = struct{}{}

		amount := strings.TrimSpace(adj.Amount)
		if amount == "" || amount == "0" || amount == "0.0" {
			return ErrClientCCAdjustmentAmountInvalid
		}
	}
	return nil
}
