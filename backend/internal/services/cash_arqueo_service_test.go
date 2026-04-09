package services

import (
	"errors"
	"testing"

	"fina/internal/models"
)

func TestDifferenceCountedMinusSystem(t *testing.T) {
	tests := []struct {
		counted, system, want string
	}{
		{"100", "100", "0"},
		{"100.50", "90", "10.5"},
		{"0", "0", "0"},
		{"10", "15", "-5"},
		{"0.00000001", "0", "0.00000001"},
	}
	for _, tt := range tests {
		got, err := DifferenceCountedMinusSystem(tt.counted, tt.system)
		if err != nil {
			t.Fatalf("counted=%q system=%q: %v", tt.counted, tt.system, err)
		}
		if got != tt.want {
			t.Errorf("DifferenceCountedMinusSystem(%q,%q) = %q; want %q", tt.counted, tt.system, got, tt.want)
		}
	}
}

func TestDifferenceCountedMinusSystem_invalid(t *testing.T) {
	_, err := DifferenceCountedMinusSystem("x", "1")
	if err == nil {
		t.Fatal("expected error")
	}
	_, err = DifferenceCountedMinusSystem("1", "y")
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestParseCashArqueoLines_duplicateCurrencyFormat(t *testing.T) {
	_, err := parseCashArqueoLines([]CashArqueoLineInput{
		{CurrencyID: "cur-1", Format: "CASH", CountedTotal: "1"},
		{CurrencyID: "cur-1", Format: "CASH", CountedTotal: "2"},
	})
	if !errors.Is(err, ErrCashArqueoDupLine) {
		t.Fatalf("got %v want ErrCashArqueoDupLine", err)
	}
}

func TestParseCashArqueoLines_sameCurrencyTwoFormatsOK(t *testing.T) {
	got, err := parseCashArqueoLines([]CashArqueoLineInput{
		{CurrencyID: "cur-1", Format: "CASH", CountedTotal: "10"},
		{CurrencyID: "cur-1", Format: "DIGITAL", CountedTotal: "20"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Format != "CASH" || got[1].Format != "DIGITAL" {
		t.Fatalf("unexpected %+v", got)
	}
}

func TestParseCashArqueoLines_badFormat(t *testing.T) {
	_, err := parseCashArqueoLines([]CashArqueoLineInput{
		{CurrencyID: "cur-1", Format: "EFT", CountedTotal: "1"},
	})
	if !errors.Is(err, ErrCashArqueoBadFormat) {
		t.Fatalf("got %v want ErrCashArqueoBadFormat", err)
	}
}

func TestValidateFormatsAgainstAccount_digitalDisabled(t *testing.T) {
	lines := []parsedArqueoLine{{CurrencyID: "c1", Format: "DIGITAL", CountedTotal: "1"}}
	ac := []models.AccountCurrencyItem{{
		CurrencyID: "c1", CashEnabled: true, DigitalEnabled: false,
	}}
	err := validateFormatsAgainstAccount(lines, ac)
	if !errors.Is(err, ErrCashArqueoFormatNotAllowed) {
		t.Fatalf("got %v want ErrCashArqueoFormatNotAllowed", err)
	}
}

func TestArqueoLineKey_usedForSystemTotals(t *testing.T) {
	k1 := arqueoLineKey("u1", "CASH")
	k2 := arqueoLineKey("u1", "DIGITAL")
	if k1 == k2 {
		t.Fatal("keys must differ")
	}
}
