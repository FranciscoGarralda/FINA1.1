package services

import (
	"math/big"
	"testing"
)

func TestNormalizeQuoteMode(t *testing.T) {
	if got := normalizeQuoteMode(""); got != QuoteModeMultiply {
		t.Fatalf("empty mode should fallback to MULTIPLY, got %s", got)
	}
	if got := normalizeQuoteMode(QuoteModeMultiply); got != QuoteModeMultiply {
		t.Fatalf("MULTIPLY should remain MULTIPLY, got %s", got)
	}
	if got := normalizeQuoteMode(QuoteModeDivide); got != QuoteModeDivide {
		t.Fatalf("DIVIDE should remain DIVIDE, got %s", got)
	}
	if got := normalizeQuoteMode("INVALID"); got != "" {
		t.Fatalf("invalid mode should return empty marker, got %s", got)
	}
}

func TestComputeEquivalentFromQuote(t *testing.T) {
	amount := new(big.Rat).SetInt64(1000)
	rate, _ := new(big.Rat).SetString("1.17")

	mul, err := computeEquivalentFromQuote(amount, rate, QuoteModeMultiply)
	if err != nil {
		t.Fatalf("multiply mode should not fail: %v", err)
	}
	if got := mul.FloatString(2); got != "1170.00" {
		t.Fatalf("multiply mode mismatch, got %s", got)
	}

	div, err := computeEquivalentFromQuote(amount, rate, QuoteModeDivide)
	if err != nil {
		t.Fatalf("divide mode should not fail: %v", err)
	}
	if got := div.FloatString(2); got != "854.70" {
		t.Fatalf("divide mode mismatch, got %s", got)
	}

	fallback, err := computeEquivalentFromQuote(amount, rate, "")
	if err != nil {
		t.Fatalf("empty mode should fallback to MULTIPLY: %v", err)
	}
	if got := fallback.FloatString(2); got != "1170.00" {
		t.Fatalf("fallback mode mismatch, got %s", got)
	}
}

func TestComputeEquivalentFromQuoteInvalidMode(t *testing.T) {
	amount := new(big.Rat).SetInt64(1000)
	rate, _ := new(big.Rat).SetString("1.17")
	if _, err := computeEquivalentFromQuote(amount, rate, "BAD_MODE"); err == nil {
		t.Fatal("expected error for invalid quote mode")
	}
}
