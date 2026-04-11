package services

import "testing"

func TestIsValidRole(t *testing.T) {
	tests := []struct {
		role string
		want bool
	}{
		{"SUPERADMIN", true},
		{"ADMIN", true},
		{"COURIER", true},
		{"", false},
		{"GUEST", false},
	}
	for _, tc := range tests {
		if got := IsValidRole(tc.role); got != tc.want {
			t.Errorf("IsValidRole(%q) = %v want %v", tc.role, got, tc.want)
		}
	}
}

func TestFallbackAllows_SUPERADMIN_hasCcView(t *testing.T) {
	if !FallbackAllows("SUPERADMIN", "cc.view") {
		t.Fatal("SUPERADMIN should allow cc.view")
	}
	if !FallbackAllows("SUPERADMIN", "operations.compra.execute") {
		t.Fatal("SUPERADMIN should allow operations.compra.execute")
	}
}

func TestFallbackAllows_COURIER_noCompraExecute(t *testing.T) {
	if FallbackAllows("COURIER", "operations.compra.execute") {
		t.Fatal("COURIER should not allow operations.compra.execute by default")
	}
	if !FallbackAllows("COURIER", "pending.view") {
		t.Fatal("COURIER should allow pending.view")
	}
}

func TestFallbackAllows_OPERATOR_hasMovementsView(t *testing.T) {
	if !FallbackAllows("OPERATOR", "movements.view") {
		t.Fatal("OPERATOR should allow movements.view")
	}
}
