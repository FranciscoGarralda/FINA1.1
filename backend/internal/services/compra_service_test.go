package services

import (
	"context"
	"errors"
	"testing"
)

// Execute: validaciones previas al acceso a DB (A-16 — regresión sin pool).

func TestCompraExecute_ErrNoOutLines(t *testing.T) {
	s := &CompraService{}
	err := s.Execute(context.Background(), "mov-1", CompraInput{
		In:    CompraInLine{Format: "CASH", Amount: "1", AccountID: "a", CurrencyID: "c"},
		Quote: CompraQuote{Rate: "1", CurrencyID: "q", Mode: "MULTIPLY"},
		Outs:  nil,
	}, "caller")
	if !errors.Is(err, ErrNoOutLines) {
		t.Fatalf("got %v want ErrNoOutLines", err)
	}
}

func TestCompraExecute_ErrInvalidAmount_Bought(t *testing.T) {
	s := &CompraService{}
	err := s.Execute(context.Background(), "mov-1", CompraInput{
		In:    CompraInLine{Format: "CASH", Amount: "0", AccountID: "a", CurrencyID: "c"},
		Quote: CompraQuote{Rate: "1", CurrencyID: "q", Mode: "MULTIPLY"},
		Outs:  []CompraOutLine{{Format: "CASH", Amount: "1", AccountID: "b"}},
	}, "caller")
	if !errors.Is(err, ErrInvalidAmount) {
		t.Fatalf("got %v want ErrInvalidAmount", err)
	}
}

func TestCompraExecute_ErrInvalidAmount_QuoteRate(t *testing.T) {
	s := &CompraService{}
	err := s.Execute(context.Background(), "mov-1", CompraInput{
		In:    CompraInLine{Format: "CASH", Amount: "100", AccountID: "a", CurrencyID: "c"},
		Quote: CompraQuote{Rate: "0", CurrencyID: "q", Mode: "MULTIPLY"},
		Outs:  []CompraOutLine{{Format: "CASH", Amount: "1", AccountID: "b"}},
	}, "caller")
	if !errors.Is(err, ErrInvalidAmount) {
		t.Fatalf("got %v want ErrInvalidAmount", err)
	}
}

func TestCompraExecute_ErrCuadreNotMatch(t *testing.T) {
	s := &CompraService{}
	// MULTIPLY: equivalent 100*10=1000; outs sum 1 → cuadre falla antes de repo/pool.
	err := s.Execute(context.Background(), "mov-1", CompraInput{
		In:    CompraInLine{Format: "CASH", Amount: "100", AccountID: "a", CurrencyID: "usd"},
		Quote: CompraQuote{Rate: "10", CurrencyID: "ars", Mode: "MULTIPLY"},
		Outs:  []CompraOutLine{{Format: "CASH", Amount: "1", AccountID: "b"}},
	}, "caller")
	if !errors.Is(err, ErrCuadreNotMatch) {
		t.Fatalf("got %v want ErrCuadreNotMatch", err)
	}
}

func TestCompraExecute_ErrInvalidAmount_OutLine(t *testing.T) {
	s := &CompraService{}
	err := s.Execute(context.Background(), "mov-1", CompraInput{
		In:    CompraInLine{Format: "CASH", Amount: "100", AccountID: "a", CurrencyID: "usd"},
		Quote: CompraQuote{Rate: "1", CurrencyID: "ars", Mode: "MULTIPLY"},
		Outs: []CompraOutLine{
			{Format: "CASH", Amount: "50", AccountID: "b"},
			{Format: "CASH", Amount: "x", AccountID: "b"},
		},
	}, "caller")
	if !errors.Is(err, ErrInvalidAmount) {
		t.Fatalf("got %v want ErrInvalidAmount", err)
	}
}

func TestCompraExecute_ErrInvalidFormat_AfterCuadre(t *testing.T) {
	s := &CompraService{}
	err := s.Execute(context.Background(), "mov-1", CompraInput{
		In:    CompraInLine{Format: "WIRE", Amount: "100", AccountID: "a", CurrencyID: "usd"},
		Quote: CompraQuote{Rate: "10", CurrencyID: "ars", Mode: "MULTIPLY"},
		Outs:  []CompraOutLine{{Format: "CASH", Amount: "1000", AccountID: "b"}},
	}, "caller")
	if !errors.Is(err, ErrInvalidAmount) {
		t.Fatalf("got %v want ErrInvalidAmount (validateFormat)", err)
	}
}
