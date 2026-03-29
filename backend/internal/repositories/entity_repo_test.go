package repositories

import (
	"context"
	"errors"
	"testing"
)

func TestEntityTableOrError(t *testing.T) {
	for _, table := range []string{"users", "accounts", "currencies", "clients"} {
		got, err := entityTableOrError(table)
		if err != nil || got != table {
			t.Fatalf("entityTableOrError(%q) = %q, %v want %q, nil", table, got, err, table)
		}
	}
	_, err := entityTableOrError("evil")
	if !errors.Is(err, ErrInvalidEntityTable) {
		t.Fatalf("entityTableOrError(evil) err = %v want ErrInvalidEntityTable", err)
	}
}

func TestGetEntityActiveStatusInvalidTableNoPool(t *testing.T) {
	r := &EntityRepo{pool: nil}
	_, err := r.GetEntityActiveStatus(context.Background(), "not_a_table", "00000000-0000-0000-0000-000000000000")
	if !errors.Is(err, ErrInvalidEntityTable) {
		t.Fatalf("GetEntityActiveStatus invalid table: %v", err)
	}
}
