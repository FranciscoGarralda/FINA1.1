package services

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// validateFormat exige CASH o DIGITAL (misma regla que compra/venta al ejecutar).
func validateFormat(format string) error {
	if format != "CASH" && format != "DIGITAL" {
		return ErrInvalidAmount
	}
	return nil
}

// lookupMovementForExecution carga tipo, estado, cliente y CC del movimiento; valida tipo esperado y BORRADOR.
func lookupMovementForExecution(
	ctx context.Context,
	pool *pgxpool.Pool,
	movementID string,
	expectedMovType string,
) (movType, movStatus, clientID string, ccEnabled bool, err error) {
	err = pool.QueryRow(ctx,
		`SELECT m.type, m.status, m.client_id::text, c.cc_enabled
		 FROM movements m
		 JOIN clients c ON c.id = m.client_id
		 WHERE m.id = $1`, movementID).
		Scan(&movType, &movStatus, &clientID, &ccEnabled)
	if err != nil {
		return "", "", "", false, ErrMovementNotFound
	}
	if movType != expectedMovType {
		return "", "", "", false, ErrMovementTypeMismatch
	}
	if movStatus != MovementStatusDraft {
		return "", "", "", false, ErrMovementNotDraft
	}
	return movType, movStatus, clientID, ccEnabled, nil
}
