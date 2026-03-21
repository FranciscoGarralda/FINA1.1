package services

import (
	"context"
	"errors"
	"regexp"
	"strings"

	"fina/internal/repositories"
)

var (
	ErrCurrencyCodeRequired = errors.New("CURRENCY_CODE_REQUIRED")
	ErrCurrencyCodeInvalid  = errors.New("CURRENCY_CODE_INVALID")
	ErrCurrencyNameRequired = errors.New("CURRENCY_NAME_REQUIRED")
	ErrCurrencyCodeDuplicate = errors.New("CURRENCY_CODE_DUPLICATE")

	currencyCodeRe = regexp.MustCompile(`^[A-Z]{2,6}$`)
)

type CurrencyService struct {
	currencyRepo *repositories.CurrencyRepo
	auditRepo    *repositories.AuditRepo
}

func NewCurrencyService(cr *repositories.CurrencyRepo, ar *repositories.AuditRepo) *CurrencyService {
	return &CurrencyService{currencyRepo: cr, auditRepo: ar}
}

type CurrencyInput struct {
	Code string `json:"code"`
	Name string `json:"name"`
}

func (s *CurrencyService) Create(ctx context.Context, input CurrencyInput, callerID string) (string, error) {
	if err := validateCurrencyInput(input); err != nil {
		return "", err
	}

	id, err := s.currencyRepo.Create(ctx, input.Code, input.Name)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "unique") {
			return "", ErrCurrencyCodeDuplicate
		}
		return "", err
	}

	s.auditRepo.Insert(ctx, "currency", &id, "create",
		nil,
		map[string]interface{}{"code": input.Code, "name": input.Name},
		callerID)

	return id, nil
}

func (s *CurrencyService) Update(ctx context.Context, id string, input CurrencyInput, callerID string) error {
	if err := validateCurrencyInput(input); err != nil {
		return err
	}

	before, err := s.currencyRepo.FindByID(ctx, id)
	if err != nil {
		return err
	}

	if err := s.currencyRepo.Update(ctx, id, input.Code, input.Name); err != nil {
		if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "unique") {
			return ErrCurrencyCodeDuplicate
		}
		return err
	}

	s.auditRepo.Insert(ctx, "currency", &id, "update",
		map[string]interface{}{"code": before.Code, "name": before.Name},
		map[string]interface{}{"code": input.Code, "name": input.Name},
		callerID)

	return nil
}

func validateCurrencyInput(input CurrencyInput) error {
	input.Code = strings.TrimSpace(input.Code)
	if input.Code == "" {
		return ErrCurrencyCodeRequired
	}
	if !currencyCodeRe.MatchString(input.Code) {
		return ErrCurrencyCodeInvalid
	}
	if strings.TrimSpace(input.Name) == "" {
		return ErrCurrencyNameRequired
	}
	return nil
}
