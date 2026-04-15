package services

import (
	"math/big"
	"testing"
)

func TestComputeResultado_CombinesUtilidadProfitMinusGastos(t *testing.T) {
	s := &ReportesService{}
	utilidad := map[string]*big.Rat{"c1": rat(t, "100")}
	profit := map[string]*big.Rat{"c1": rat(t, "50")}
	gastos := map[string]*big.Rat{"c1": rat(t, "200")}
	out := s.computeResultado(utilidad, profit, gastos)
	got := out["c1"].FloatString(2)
	if got != "-50.00" {
		t.Fatalf("expected -50.00, got %s", got)
	}
}

func TestParseAggRat(t *testing.T) {
	r, err := parseAggRat("123.45", "t")
	if err != nil {
		t.Fatal(err)
	}
	if r.FloatString(2) != "123.45" {
		t.Fatalf("got %s", r.FloatString(2))
	}
}

func rat(t *testing.T, s string) *big.Rat {
	t.Helper()
	r, ok := new(big.Rat).SetString(s)
	if !ok {
		t.Fatalf("bad rat %q", s)
	}
	return r
}
