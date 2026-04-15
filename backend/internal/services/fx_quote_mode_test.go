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

func TestRoundRatToDecimalPlacesHalfAwayFromZero(t *testing.T) {
	third := new(big.Rat).Quo(big.NewRat(100, 1), big.NewRat(3, 1))
	got := RoundRatToDecimalPlaces(third, 2)
	want, _ := new(big.Rat).SetString("33.33")
	if got.Cmp(want) != 0 {
		t.Fatalf("100/3 to 2dp: got %s want %s", got.FloatString(4), want.FloatString(4))
	}

	neg := new(big.Rat).Neg(new(big.Rat).Set(third))
	gotNeg := RoundRatToDecimalPlaces(neg, 2)
	wantNeg, _ := new(big.Rat).SetString("-33.33")
	if gotNeg.Cmp(wantNeg) != 0 {
		t.Fatalf("negative third: got %s want %s", gotNeg.FloatString(4), wantNeg.FloatString(4))
	}
}

// Cuadre: racional crudo distinto pero mismo valor a 2 decimales tras redondear (caso típico DIVIDE).
func TestCuadreRoundedMatchVentaLike(t *testing.T) {
	rate, _ := new(big.Rat).SetString("1.17")
	sold := big.NewRat(1000, 1)
	equiv, err := computeEquivalentFromQuote(sold, rate, QuoteModeDivide)
	if err != nil {
		t.Fatal(err)
	}
	sum, _ := new(big.Rat).SetString("854.70")
	if equiv.Cmp(sum) == 0 {
		t.Fatal("expected raw mismatch for this scenario")
	}
	eqR := RoundRatToDecimalPlaces(equiv, 2)
	sumR := RoundRatToDecimalPlaces(sum, 2)
	if eqR.Cmp(sumR) != 0 {
		t.Fatalf("rounded should match: eqR=%s sumR=%s raw=%s", eqR.FloatString(4), sumR.FloatString(4), equiv.FloatString(8))
	}
}

func TestCuadreRoundedMismatchRealCent(t *testing.T) {
	a, _ := new(big.Rat).SetString("100.00")
	b, _ := new(big.Rat).SetString("100.01")
	if RoundRatToDecimalPlaces(a, 2).Cmp(RoundRatToDecimalPlaces(b, 2)) == 0 {
		t.Fatal("expected mismatch")
	}
}
