package services

import (
	"errors"
	"testing"
)

func TestValidateFormat(t *testing.T) {
	tests := []struct {
		name    string
		format  string
		wantErr bool
	}{
		{"cash_upper", "CASH", false},
		{"digital_upper", "DIGITAL", false},
		{"empty", "", true},
		{"wire", "WIRE", true},
		{"cash_lower", "cash", true},
		{"mixed", "CASH_DIGITAL", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateFormat(tt.format)
			if tt.wantErr {
				if !errors.Is(err, ErrInvalidAmount) {
					t.Fatalf("want ErrInvalidAmount, got %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
		})
	}
}
