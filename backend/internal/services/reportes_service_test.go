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

func TestMergeCodesForResultado_utilidadWins(t *testing.T) {
	u := map[string]string{"1": "USD"}
	p := map[string]string{"1": "XXX", "2": "ARS"}
	g := map[string]string{"1": "YYY"}
	m := mergeCodesForResultado(u, p, g)
	if m["1"] != "USD" {
		t.Fatalf("id 1: want USD, got %q", m["1"])
	}
	if m["2"] != "ARS" {
		t.Fatalf("id 2: want ARS, got %q", m["2"])
	}
}

func TestMergeCodesForResultado_onlyProfitAndGastos(t *testing.T) {
	m := mergeCodesForResultado(nil, map[string]string{"a": "EUR"}, map[string]string{"b": "GBP"})
	if m["a"] != "EUR" || m["b"] != "GBP" {
		t.Fatalf("got %#v", m)
	}
}

func TestMapToSlice_includesCurrencyCode(t *testing.T) {
	amounts := map[string]*big.Rat{"x": rat(t, "1.5")}
	codes := map[string]string{"x": "USD"}
	items := mapToSlice(amounts, codes)
	if len(items) != 1 {
		t.Fatalf("len=%d", len(items))
	}
	if items[0].CurrencyID != "x" || items[0].CurrencyCode != "USD" || items[0].Amount != "1.50" {
		t.Fatalf("got %+v", items[0])
	}
}

func TestMapToSlice_empty(t *testing.T) {
	if len(mapToSlice(nil, nil)) != 0 {
		t.Fatal("expected empty slice")
	}
}
