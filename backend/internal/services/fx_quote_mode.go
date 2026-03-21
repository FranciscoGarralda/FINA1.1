package services

import (
	"errors"
	"math/big"
)

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
