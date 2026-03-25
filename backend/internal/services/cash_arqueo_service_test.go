package services

import "testing"

func TestDifferenceCountedMinusSystem(t *testing.T) {
	tests := []struct {
		counted, system, want string
	}{
		{"100", "100", "0"},
		{"100.50", "90", "10.5"},
		{"0", "0", "0"},
		{"10", "15", "-5"},
		{"0.00000001", "0", "0.00000001"},
	}
	for _, tt := range tests {
		got, err := DifferenceCountedMinusSystem(tt.counted, tt.system)
		if err != nil {
			t.Fatalf("counted=%q system=%q: %v", tt.counted, tt.system, err)
		}
		if got != tt.want {
			t.Errorf("DifferenceCountedMinusSystem(%q,%q) = %q; want %q", tt.counted, tt.system, got, tt.want)
		}
	}
}

func TestDifferenceCountedMinusSystem_invalid(t *testing.T) {
	_, err := DifferenceCountedMinusSystem("x", "1")
	if err == nil {
		t.Fatal("expected error")
	}
	_, err = DifferenceCountedMinusSystem("1", "y")
	if err == nil {
		t.Fatal("expected error")
	}
}
