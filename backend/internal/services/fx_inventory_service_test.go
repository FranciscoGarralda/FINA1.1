package services

import (
	"math/big"
	"testing"

	"fina/internal/repositories"
)

func TestAggregateCompraLines(t *testing.T) {
	lines := []repositories.MovementLineRow{
		{Side: "IN", CurrencyID: "usd", Amount: "100"},
		{Side: "OUT", CurrencyID: "ars", Amount: "60000"},
		{Side: "OUT", CurrencyID: "ars", Amount: "40000"},
	}
	tid, tsum, qsum, qid, err := aggregateCompraLines(lines)
	if err != nil {
		t.Fatal(err)
	}
	if tid != "usd" || qid != "ars" {
		t.Fatalf("currency ids: traded=%s quote=%s", tid, qid)
	}
	if tsum.Cmp(big.NewRat(100, 1)) != 0 || qsum.Cmp(big.NewRat(100000, 1)) != 0 {
		t.Fatalf("sums traded=%s quote=%s", tsum.FloatString(4), qsum.FloatString(4))
	}
}

func TestAggregateVentaLines(t *testing.T) {
	lines := []repositories.MovementLineRow{
		{Side: "OUT", CurrencyID: "usd", Amount: "50"},
		{Side: "IN", CurrencyID: "ars", Amount: "20000"},
		{Side: "IN", CurrencyID: "ars", Amount: "5000"},
	}
	tid, tsum, qsum, qid, err := aggregateVentaLines(lines)
	if err != nil {
		t.Fatal(err)
	}
	if tid != "usd" || qid != "ars" {
		t.Fatalf("currency ids: traded=%s quote=%s", tid, qid)
	}
	if tsum.Cmp(big.NewRat(50, 1)) != 0 || qsum.Cmp(big.NewRat(25000, 1)) != 0 {
		t.Fatalf("sums traded=%s quote=%s", tsum.FloatString(4), qsum.FloatString(4))
	}
}

func TestAvgCost(t *testing.T) {
	q := big.NewRat(100, 1)
	c := big.NewRat(100000, 1)
	a := avgCost(q, c)
	if a.Cmp(big.NewRat(1000, 1)) != 0 {
		t.Fatalf("avg=%s want 1000", a.FloatString(4))
	}
	if avgCost(big.NewRat(0, 1), big.NewRat(5, 1)).Sign() != 0 {
		t.Fatal("avg with zero qty should be 0")
	}
}

func TestVentaRealizedMath(t *testing.T) {
	// Stock 100 USD @ 1000 ARS/USD; sell 50 for 25000 ARS → realized = 25000 - 50000 = -25000
	posQty := big.NewRat(100, 1)
	posCost := big.NewRat(100000, 1)
	sellQty := big.NewRat(50, 1)
	quote := big.NewRat(25000, 1)
	av := avgCost(posQty, posCost)
	costRem := new(big.Rat).Mul(sellQty, av)
	realized := new(big.Rat).Sub(quote, costRem)
	if realized.Cmp(big.NewRat(-25000, 1)) != 0 {
		t.Fatalf("realized=%s", realized.FloatString(4))
	}
}

func TestTransferenciaPrincipalLegLines(t *testing.T) {
	lines := []repositories.MovementLineRow{
		{Side: "OUT", CurrencyID: "usd", Amount: "100"},
		{Side: "IN", CurrencyID: "ars", Amount: "140000"},
		{Side: "IN", CurrencyID: "usd", Amount: "10"},
	}
	pr, ok := transferenciaPrincipalLegLines(lines)
	if !ok || len(pr) != 2 {
		t.Fatalf("ok=%v len=%d", ok, len(pr))
	}
	if pr[0].CurrencyID != "usd" || pr[0].Amount != "100" || pr[1].CurrencyID != "ars" {
		t.Fatalf("got %+v %+v", pr[0], pr[1])
	}
}
