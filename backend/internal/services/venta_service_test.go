package services

import (
	"context"
	"errors"
	"testing"
)

func TestVentaExecute_ErrNoInLines(t *testing.T) {
	s := &VentaService{}
	err := s.Execute(context.Background(), "mov-1", VentaInput{
		Out:   VentaOutLine{Format: "CASH", Amount: "1", AccountID: "a", CurrencyID: "usd"},
		Quote: VentaQuote{Rate: "1", CurrencyID: "ars", Mode: "MULTIPLY"},
		Ins:   nil,
	}, "caller")
	if !errors.Is(err, ErrNoInLines) {
		t.Fatalf("got %v want ErrNoInLines", err)
	}
}

func TestVentaExecute_ErrInvalidAmount_Sold(t *testing.T) {
	s := &VentaService{}
	err := s.Execute(context.Background(), "mov-1", VentaInput{
		Out:   VentaOutLine{Format: "CASH", Amount: "-5", AccountID: "a", CurrencyID: "usd"},
		Quote: VentaQuote{Rate: "1", CurrencyID: "ars", Mode: "MULTIPLY"},
		Ins:   []VentaInLine{{Format: "CASH", Amount: "1", AccountID: "b"}},
	}, "caller")
	if !errors.Is(err, ErrInvalidAmount) {
		t.Fatalf("got %v want ErrInvalidAmount", err)
	}
}

func TestVentaExecute_ErrInvalidAmount_QuoteRate(t *testing.T) {
	s := &VentaService{}
	err := s.Execute(context.Background(), "mov-1", VentaInput{
		Out:   VentaOutLine{Format: "CASH", Amount: "100", AccountID: "a", CurrencyID: "usd"},
		Quote: VentaQuote{Rate: "0", CurrencyID: "ars", Mode: "MULTIPLY"},
		Ins:   []VentaInLine{{Format: "CASH", Amount: "1", AccountID: "b"}},
	}, "caller")
	if !errors.Is(err, ErrInvalidAmount) {
		t.Fatalf("got %v want ErrInvalidAmount", err)
	}
}

func TestVentaExecute_ErrCuadreNotMatch(t *testing.T) {
	s := &VentaService{}
	// sold 100, rate 10 → equivalent 1000; ins sum 1
	err := s.Execute(context.Background(), "mov-1", VentaInput{
		Out:   VentaOutLine{Format: "CASH", Amount: "100", AccountID: "a", CurrencyID: "usd"},
		Quote: VentaQuote{Rate: "10", CurrencyID: "ars", Mode: "MULTIPLY"},
		Ins:   []VentaInLine{{Format: "CASH", Amount: "1", AccountID: "b"}},
	}, "caller")
	if !errors.Is(err, ErrCuadreNotMatch) {
		t.Fatalf("got %v want ErrCuadreNotMatch", err)
	}
}

func TestVentaExecute_ErrInvalidAmount_InLine(t *testing.T) {
	s := &VentaService{}
	err := s.Execute(context.Background(), "mov-1", VentaInput{
		Out:   VentaOutLine{Format: "CASH", Amount: "10", AccountID: "a", CurrencyID: "usd"},
		Quote: VentaQuote{Rate: "1", CurrencyID: "ars", Mode: "MULTIPLY"},
		Ins: []VentaInLine{
			{Format: "CASH", Amount: "5", AccountID: "b"},
			{Format: "CASH", Amount: "bad", AccountID: "b"},
		},
	}, "caller")
	if !errors.Is(err, ErrInvalidAmount) {
		t.Fatalf("got %v want ErrInvalidAmount", err)
	}
}

func TestVentaExecute_ErrInvalidFormat_AfterCuadre(t *testing.T) {
	s := &VentaService{}
	err := s.Execute(context.Background(), "mov-1", VentaInput{
		Out:   VentaOutLine{Format: "WIRE", Amount: "100", AccountID: "a", CurrencyID: "usd"},
		Quote: VentaQuote{Rate: "10", CurrencyID: "ars", Mode: "MULTIPLY"},
		Ins:   []VentaInLine{{Format: "CASH", Amount: "1000", AccountID: "b"}},
	}, "caller")
	if !errors.Is(err, ErrInvalidAmount) {
		t.Fatalf("got %v want ErrInvalidAmount (validateFormat)", err)
	}
}
