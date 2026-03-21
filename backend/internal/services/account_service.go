package services

import (
	"context"
	"errors"
	"strings"

	"fina/internal/models"
	"fina/internal/repositories"
)

var (
	ErrAccountNameRequired   = errors.New("ACCOUNT_NAME_REQUIRED")
	ErrAccountFormatRequired = errors.New("ACCOUNT_FORMAT_REQUIRED")
)

type AccountService struct {
	accountRepo *repositories.AccountRepo
	auditRepo   *repositories.AuditRepo
}

func NewAccountService(ar *repositories.AccountRepo, aud *repositories.AuditRepo) *AccountService {
	return &AccountService{accountRepo: ar, auditRepo: aud}
}

type AccountInput struct {
	Name string `json:"name"`
}

func (s *AccountService) Create(ctx context.Context, input AccountInput, callerID string) (string, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return "", ErrAccountNameRequired
	}

	id, err := s.accountRepo.Create(ctx, name)
	if err != nil {
		return "", err
	}

	s.auditRepo.Insert(ctx, "account", &id, "create",
		nil,
		map[string]interface{}{"name": name},
		callerID)

	return id, nil
}

func (s *AccountService) Update(ctx context.Context, id string, input AccountInput, callerID string) error {
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return ErrAccountNameRequired
	}

	before, err := s.accountRepo.FindByID(ctx, id)
	if err != nil {
		return err
	}

	if err := s.accountRepo.Update(ctx, id, name); err != nil {
		return err
	}

	s.auditRepo.Insert(ctx, "account", &id, "update",
		map[string]interface{}{"name": before.Name},
		map[string]interface{}{"name": name},
		callerID)

	return nil
}

func (s *AccountService) GetAccountCurrencies(ctx context.Context, accountID string) ([]models.AccountCurrencyItem, error) {
	return s.accountRepo.GetAccountCurrencies(ctx, accountID)
}

func (s *AccountService) UpdateAccountCurrencies(ctx context.Context, accountID string, items []repositories.AccountCurrencyInput, callerID string) error {
	for _, item := range items {
		if !item.CashEnabled && !item.DigitalEnabled {
			return ErrAccountFormatRequired
		}
	}

	if err := s.accountRepo.ReplaceAccountCurrencies(ctx, accountID, items); err != nil {
		return err
	}

	s.auditRepo.Insert(ctx, "account", &accountID, "update_currencies",
		nil,
		map[string]interface{}{"currencies_count": len(items)},
		callerID)

	return nil
}
