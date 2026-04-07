package services

import (
	"context"
	"errors"
	"testing"
)

func TestOpeningPendingService_Create_InvalidKind(t *testing.T) {
	svc := &OpeningPendingService{}
	_, err := svc.Create(context.Background(), OpeningPendingInput{
		ClientID:    "00000000-0000-0000-0000-000000000001",
		PendingKind: "OTRO",
		AccountID:   "x",
		CurrencyID:  "y",
		Format:      "CASH",
		Amount:      "1",
	}, "user")
	if err == nil {
		t.Fatal("expected error")
	}
	if !errors.Is(err, ErrInvalidOpeningPendingKind) {
		t.Fatalf("expected ErrInvalidOpeningPendingKind, got %v", err)
	}
}
