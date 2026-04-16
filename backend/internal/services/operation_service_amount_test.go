package services

import (
	"math/big"
	"testing"
)

func TestReverseSignedAmount_netsZeroWithOriginal(t *testing.T) {
	for _, in := range []string{"100", "-50", "0.25", "0"} {
		t.Run(in, func(t *testing.T) {
			got, err := reverseSignedAmount(in)
			if err != nil {
				t.Fatal(err)
			}
			orig, _ := new(big.Rat).SetString(in)
			out, _ := new(big.Rat).SetString(got)
			sum := new(big.Rat).Add(orig, out)
			if sum.Sign() != 0 {
				t.Fatalf("%s + %s should net zero, got %s", in, got, sum.FloatString(8))
			}
		})
	}
}

func TestReverseSignedAmount_invalid(t *testing.T) {
	if _, err := reverseSignedAmount("not-a-number"); err == nil {
		t.Fatal("expected error")
	}
}
