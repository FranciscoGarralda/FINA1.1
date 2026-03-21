package services

import (
	"context"

	"fina/internal/repositories"
)

type CashPositionBalance struct {
	CurrencyID   string `json:"currency_id"`
	CurrencyCode string `json:"currency_code"`
	Format       string `json:"format"`
	Balance      string `json:"balance"`
}

type CashPositionAccount struct {
	AccountID   string                `json:"account_id"`
	AccountName string                `json:"account_name"`
	Balances    []CashPositionBalance `json:"balances"`
}

type CashPositionService struct {
	repo *repositories.CashPositionRepo
}

func NewCashPositionService(repo *repositories.CashPositionRepo) *CashPositionService {
	return &CashPositionService{repo: repo}
}

func (s *CashPositionService) GetPositions(ctx context.Context, asOfDate string) ([]CashPositionAccount, error) {
	rows, err := s.repo.ListPositions(ctx, asOfDate)
	if err != nil {
		return nil, err
	}

	accountOrder := []string{}
	accountMap := map[string]*CashPositionAccount{}

	for _, r := range rows {
		acc, ok := accountMap[r.AccountID]
		if !ok {
			acc = &CashPositionAccount{
				AccountID:   r.AccountID,
				AccountName: r.AccountName,
			}
			accountMap[r.AccountID] = acc
			accountOrder = append(accountOrder, r.AccountID)
		}
		acc.Balances = append(acc.Balances, CashPositionBalance{
			CurrencyID:   r.CurrencyID,
			CurrencyCode: r.CurrencyCode,
			Format:       r.Format,
			Balance:      r.Balance,
		})
	}

	result := make([]CashPositionAccount, 0, len(accountOrder))
	for _, id := range accountOrder {
		result = append(result, *accountMap[id])
	}
	return result, nil
}
