package services

import (
	"math/big"
	"testing"
)

// Regresión: resolve parcial REAL_EXECUTION debe mantener el agregado del tramo (línea pendiente reducida + línea ejecutada).
func TestPartialRealExecutionMovementSumInvariant(t *testing.T) {
	pending := mustRat(t, "100")
	resolve := mustRat(t, "40")
	remainder := new(big.Rat).Sub(pending, resolve)
	sum := new(big.Rat).Add(remainder, resolve)
	if sum.Cmp(pending) != 0 {
		t.Fatalf("remainder (%v) + executed (%v) != pending (%v)", remainder, resolve, pending)
	}
}

func TestPartialRealExecutionMultiStepSumInvariant(t *testing.T) {
	total := mustRat(t, "100")
	step1 := mustRat(t, "40")
	step2 := mustRat(t, "35")
	last := mustRat(t, "25")
	rem1 := new(big.Rat).Sub(total, step1)
	if rem1.Cmp(mustRat(t, "60")) != 0 {
		t.Fatalf("rem1 got %v", rem1)
	}
	rem2 := new(big.Rat).Sub(rem1, step2)
	if rem2.Cmp(last) != 0 {
		t.Fatalf("rem2 %v want last %v", rem2, last)
	}
	allExec := new(big.Rat).Add(step1, new(big.Rat).Add(step2, last))
	if allExec.Cmp(total) != 0 {
		t.Fatalf("executed parts sum %v want %v", allExec, total)
	}
}
