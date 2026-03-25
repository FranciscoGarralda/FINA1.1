package http

import (
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestMapPostgresClientErr_undefinedColumn(t *testing.T) {
	err := &pgconn.PgError{Code: "42703", Message: `column "department" of relation "clients" does not exist`}
	st, code, _, ok := mapPostgresClientErr(err)
	if !ok {
		t.Fatal("expected mapped error for 42703")
	}
	if st != http.StatusInternalServerError || code != "DB_SCHEMA_MISMATCH" {
		t.Fatalf("got status=%d code=%s", st, code)
	}
}

func TestMapPostgresClientErr_foreignKey(t *testing.T) {
	err := &pgconn.PgError{Code: "23503", Message: "insert violates foreign key"}
	st, code, _, ok := mapPostgresClientErr(err)
	if !ok || st != http.StatusBadRequest || code != "REFERENTIAL_INTEGRITY" {
		t.Fatalf("got ok=%v status=%d code=%s", ok, st, code)
	}
}

func TestMapPostgresClientErr_wrapped(t *testing.T) {
	inner := &pgconn.PgError{Code: "42703", Message: "missing column"}
	err := &testWrap{err: inner}
	st, code, _, ok := mapPostgresClientErr(err)
	if !ok || code != "DB_SCHEMA_MISMATCH" {
		t.Fatalf("errors.As should unwrap: ok=%v code=%s status=%d", ok, code, st)
	}
}

type testWrap struct{ err error }

func (e *testWrap) Error() string { return e.err.Error() }
func (e *testWrap) Unwrap() error { return e.err }
