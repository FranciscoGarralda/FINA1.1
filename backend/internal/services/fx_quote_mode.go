package services

import (
	"errors"
	"math/big"
)

// RoundRatToDecimalPlaces redondea r a `places` decimales, half away from zero.
// Solo para validación de cuadre (VENTA/COMPRA); no altera la fórmula de cotización.
func RoundRatToDecimalPlaces(r *big.Rat, places int) *big.Rat {
	if r == nil {
		return new(big.Rat)
	}
	if places < 0 {
		places = 0
	}
	if r.Sign() == 0 {
		return new(big.Rat)
	}
	neg := r.Sign() < 0
	a := new(big.Rat).Abs(new(big.Rat).Set(r))

	scale := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(places)), nil)
	scaled := new(big.Rat).Mul(a, new(big.Rat).SetInt(scale))

	p := scaled.Num()
	q := scaled.Denom()
	// Entero más cercano a p/q, half up (equiv. half away from zero en positivos).
	two := big.NewInt(2)
	num := new(big.Int).Add(new(big.Int).Mul(two, p), q)
	den := new(big.Int).Mul(two, q)
	k := new(big.Int).Quo(num, den)

	out := new(big.Rat).SetFrac(k, scale)
	if neg {
		out.Neg(out)
	}
	return out
}

const (
	QuoteModeMultiply = "MULTIPLY"
	QuoteModeDivide   = "DIVIDE"
)

var ErrInvalidQuoteMode = errors.New("INVALID_QUOTE_MODE")

func normalizeQuoteMode(mode string) string {
	switch mode {
	case "", QuoteModeMultiply:
		return QuoteModeMultiply
	case QuoteModeDivide:
		return QuoteModeDivide
	default:
		return ""
	}
}

func computeEquivalentFromQuote(baseAmount, rate *big.Rat, mode string) (*big.Rat, error) {
	switch normalizeQuoteMode(mode) {
	case QuoteModeMultiply:
		return new(big.Rat).Mul(baseAmount, rate), nil
	case QuoteModeDivide:
		return new(big.Rat).Quo(baseAmount, rate), nil
	default:
		return nil, ErrInvalidQuoteMode
	}
}
