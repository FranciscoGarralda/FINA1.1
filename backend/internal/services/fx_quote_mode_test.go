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

func TestImpliedBaseFromQuoteTotalRoundTrip(t *testing.T) {
	rate, _ := new(big.Rat).SetString("1.435")
	base, _ := new(big.Rat).SetString("123.456")
	eq, err := computeEquivalentFromQuote(base, rate, QuoteModeMultiply)
	if err != nil {
		t.Fatal(err)
	}
	back, err := impliedBaseFromQuoteTotal(eq, rate, QuoteModeMultiply)
	if err != nil {
		t.Fatal(err)
	}
	if base.Cmp(back) != 0 {
		t.Fatalf("MULTIPLY inverse: want %s got %s", base.FloatString(8), back.FloatString(8))
	}
	eq2, _ := computeEquivalentFromQuote(base, rate, QuoteModeDivide)
	back2, _ := impliedBaseFromQuoteTotal(eq2, rate, QuoteModeDivide)
	if base.Cmp(back2) != 0 {
		t.Fatalf("DIVIDE inverse: want %s got %s", base.FloatString(8), back2.FloatString(8))
	}
}

// Caso real: ARS 2.750.000, cotización 1.435,00 (ARS/USD) = 1435 en número, USD 1.916,38 — vía (1) falla, vía (2) pasa.
func TestCuadreVentaOK_Path2_2750000(t *testing.T) {
	inSum, _ := new(big.Rat).SetString("2750000")
	rate, _ := new(big.Rat).SetString("1435")
	sold, _ := new(big.Rat).SetString("1916.38")
	equiv, err := computeEquivalentFromQuote(sold, rate, QuoteModeMultiply)
	if err != nil {
		t.Fatal(err)
	}
	r2 := func(r *big.Rat) *big.Rat { return RoundRatToDecimalPlaces(r, 2) }
	if r2(equiv).Cmp(r2(inSum)) == 0 {
		t.Fatal("path1 should not match raw for this scenario")
	}
	if !cuadreVentaOK(equiv, inSum, sold, rate, QuoteModeMultiply) {
		t.Fatal("expected path2 to accept")
	}
}

func TestCuadreVentaOK_Path1Only(t *testing.T) {
	inSum, _ := new(big.Rat).SetString("2750005.30")
	rate, _ := new(big.Rat).SetString("1435")
	sold, _ := new(big.Rat).SetString("1916.38")
	equiv, _ := computeEquivalentFromQuote(sold, rate, QuoteModeMultiply)
	if !cuadreVentaOK(equiv, inSum, sold, rate, QuoteModeMultiply) {
		t.Fatal("expected path1 match")
	}
}

func TestCuadreVentaOK_RejectWrongUSD(t *testing.T) {
	inSum, _ := new(big.Rat).SetString("2750000")
	rate, _ := new(big.Rat).SetString("1435")
	sold, _ := new(big.Rat).SetString("2000.00")
	equiv, _ := computeEquivalentFromQuote(sold, rate, QuoteModeMultiply)
	if cuadreVentaOK(equiv, inSum, sold, rate, QuoteModeMultiply) {
		t.Fatal("expected reject")
	}
}

func TestCuadreCompraOK_Path2Mirror(t *testing.T) {
	bought, _ := new(big.Rat).SetString("1916.38")
	rate, _ := new(big.Rat).SetString("1435")
	outSum, _ := new(big.Rat).SetString("2750000")
	equiv, _ := computeEquivalentFromQuote(bought, rate, QuoteModeMultiply)
	r2 := func(r *big.Rat) *big.Rat { return RoundRatToDecimalPlaces(r, 2) }
	if r2(equiv).Cmp(r2(outSum)) == 0 {
		t.Fatal("path1 should not match raw")
	}
	if !cuadreCompraOK(equiv, outSum, bought, rate, QuoteModeMultiply) {
		t.Fatal("expected path2 accept compra")
	}
}

// Mismo caso numérico que venta vía 2: base USD, total ARS funcional, tasa MULTIPLY.
func TestCuadreTransfOK_Path2_2750000(t *testing.T) {
	base, _ := new(big.Rat).SetString("1916.38")
	total, _ := new(big.Rat).SetString("2750000")
	rate, _ := new(big.Rat).SetString("1435")
	equiv, _ := computeEquivalentFromQuote(base, rate, QuoteModeMultiply)
	r2 := func(r *big.Rat) *big.Rat { return RoundRatToDecimalPlaces(r, 2) }
	if r2(equiv).Cmp(r2(total)) == 0 {
		t.Fatal("path1 should not match raw for this scenario")
	}
	if !cuadreTransfOK(base, total, rate, QuoteModeMultiply) {
		t.Fatal("expected cuadreTransfOK path2")
	}
}

func TestCuadreTransfOK_RejectWrongBase(t *testing.T) {
	base, _ := new(big.Rat).SetString("2000.00")
	total, _ := new(big.Rat).SetString("2750000")
	rate, _ := new(big.Rat).SetString("1435")
	if cuadreTransfOK(base, total, rate, QuoteModeMultiply) {
		t.Fatal("expected reject")
	}
}

func TestCuadreTransfOK_DivideMode(t *testing.T) {
	base, _ := new(big.Rat).SetString("100")
	rate, _ := new(big.Rat).SetString("2")
	total, _ := computeEquivalentFromQuote(base, rate, QuoteModeDivide)
	if !cuadreTransfOK(base, total, rate, QuoteModeDivide) {
		t.Fatal("expected path1 exact for divide clean case")
	}
}
