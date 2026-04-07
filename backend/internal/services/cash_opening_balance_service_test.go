package services

import (
	"context"
	"errors"
	"testing"
)

func TestCashOpeningBalanceService_Create_NoLines(t *testing.T) {
	svc := &CashOpeningBalanceService{}
	_, err := svc.Create(context.Background(), CashOpeningBalanceInput{Lines: nil}, "u1")
	if !errors.Is(err, ErrOpeningBalanceNoLines) {
		t.Fatalf("expected ErrOpeningBalanceNoLines, got %v", err)
	}
}

func TestCashOpeningBalanceService_Create_DuplicateLine(t *testing.T) {
	svc := &CashOpeningBalanceService{}
	_, err := svc.Create(context.Background(), CashOpeningBalanceInput{
		Lines: []CashOpeningBalanceLineInput{
			{AccountID: "a1", CurrencyID: "c1", Format: "CASH", Amount: "100"},
			{AccountID: "a1", CurrencyID: "c1", Format: "CASH", Amount: "50"},
		},
	}, "u1")
	if !errors.Is(err, ErrDuplicateOpeningBalanceLine) {
		t.Fatalf("expected ErrDuplicateOpeningBalanceLine, got %v", err)
	}
}
