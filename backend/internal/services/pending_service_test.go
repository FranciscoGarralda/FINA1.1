package services

import (
	"errors"
	"math/big"
	"testing"

	"fina/internal/repositories"
)

func mustRat(t *testing.T, s string) *big.Rat {
	t.Helper()
	r, ok := new(big.Rat).SetString(s)
	if !ok {
		t.Fatalf("invalid rat %q", s)
	}
	return r
}

func TestValidatePendingResolvePreTx_partialNotAllowed(t *testing.T) {
	p := &repositories.PendingDetail{Amount: "100", CcEnabled: true}
	in := ResolveInput{Amount: "50", Format: "CASH"}
	err := validatePendingResolvePreTx(p, in, "REAL_EXECUTION",
		mustRat(t, "50"), mustRat(t, "100"), true, false)
	if !errors.Is(err, ErrPartialNotAllowed) {
		t.Fatalf("got %v want ErrPartialNotAllowed", err)
	}
}

func TestValidatePendingResolvePreTx_realBadFormat(t *testing.T) {
	p := &repositories.PendingDetail{Amount: "100"}
	in := ResolveInput{Amount: "100", Format: "INVALID"}
	err := validatePendingResolvePreTx(p, in, "REAL_EXECUTION",
		mustRat(t, "100"), mustRat(t, "100"), false, true)
	if !errors.Is(err, ErrInvalidResolveAmount) {
		t.Fatalf("got %v want ErrInvalidResolveAmount", err)
	}
}

func TestValidatePendingResolvePreTx_compensatedNoCC(t *testing.T) {
	p := &repositories.PendingDetail{Amount: "100", CcEnabled: false}
	in := ResolveInput{Amount: "100", ResolvedByMovementID: "mov-1"}
	err := validatePendingResolvePreTx(p, in, "COMPENSATED",
		mustRat(t, "100"), mustRat(t, "100"), false, true)
	if !errors.Is(err, ErrCompensationOnlyForCC) {
		t.Fatalf("got %v want ErrCompensationOnlyForCC", err)
	}
}

func TestValidatePendingResolvePreTx_compensatedPartialAmount(t *testing.T) {
	p := &repositories.PendingDetail{Amount: "100", CcEnabled: true}
	in := ResolveInput{Amount: "50", ResolvedByMovementID: "mov-1"}
	err := validatePendingResolvePreTx(p, in, "COMPENSATED",
		mustRat(t, "50"), mustRat(t, "100"), true, true)
	if !errors.Is(err, ErrCompensatedPartialNotAllowed) {
		t.Fatalf("got %v want ErrCompensatedPartialNotAllowed", err)
	}
}

func TestValidatePendingResolvePreTx_compensatedMissingRef(t *testing.T) {
	p := &repositories.PendingDetail{Amount: "100", CcEnabled: true}
	in := ResolveInput{Amount: "100", ResolvedByMovementID: ""}
	err := validatePendingResolvePreTx(p, in, "COMPENSATED",
		mustRat(t, "100"), mustRat(t, "100"), false, true)
	if !errors.Is(err, ErrCompensatedRequiresRef) {
		t.Fatalf("got %v want ErrCompensatedRequiresRef", err)
	}
}

func TestValidatePendingResolvePreTx_okRealFull(t *testing.T) {
	p := &repositories.PendingDetail{Amount: "100"}
	in := ResolveInput{Amount: "100", Format: "DIGITAL"}
	err := validatePendingResolvePreTx(p, in, "REAL_EXECUTION",
		mustRat(t, "100"), mustRat(t, "100"), false, true)
	if err != nil {
		t.Fatal(err)
	}
}

func TestValidatePendingResolvePreTx_okCompensated(t *testing.T) {
	p := &repositories.PendingDetail{Amount: "100", CcEnabled: true}
	in := ResolveInput{Amount: "100", ResolvedByMovementID: "mov-1"}
	err := validatePendingResolvePreTx(p, in, "COMPENSATED",
		mustRat(t, "100"), mustRat(t, "100"), false, true)
	if err != nil {
		t.Fatal(err)
	}
}

func TestValidatePendingResolvePreTx_okPartialWhenAllowed(t *testing.T) {
	p := &repositories.PendingDetail{Amount: "100"}
	in := ResolveInput{Amount: "40", Format: "CASH"}
	err := validatePendingResolvePreTx(p, in, "REAL_EXECUTION",
		mustRat(t, "40"), mustRat(t, "100"), true, true)
	if err != nil {
		t.Fatal(err)
	}
}

func TestValidatePendingCancelable(t *testing.T) {
	if err := validatePendingCancelable(&repositories.PendingDetail{Status: "ABIERTO"}); err != nil {
		t.Fatal(err)
	}
	if err := validatePendingCancelable(&repositories.PendingDetail{Status: "RESUELTO"}); !errors.Is(err, ErrPendingAlreadyResolved) {
		t.Fatalf("got %v", err)
	}
}
