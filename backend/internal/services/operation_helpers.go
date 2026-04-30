package services

import (
	"context"
	"strings"

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

// lookupArbitrajeClientsForExecution carga estado del movimiento y los dos clientes del piloto Arbitraje.
func lookupArbitrajeClientsForExecution(ctx context.Context, pool *pgxpool.Pool, movementID string) (
	costClientID string,
	cobClientID string,
	ccCostEnabled bool,
	ccCobEnabled bool,
	err error,
) {
	var status string
	var costPtr *string
	var cobPtr *string
	qErr := pool.QueryRow(ctx,
		`SELECT m.status,
		        m.arbitraje_cost_client_id::text,
		        m.arbitraje_cobrado_client_id::text,
		        COALESCE(cc.cc_enabled, false),
		        COALESCE(cb.cc_enabled, false)
		 FROM movements m
		 LEFT JOIN clients cc ON cc.id = m.arbitraje_cost_client_id
		 LEFT JOIN clients cb ON cb.id = m.arbitraje_cobrado_client_id
		 WHERE m.id = $1 AND m.type = 'ARBITRAJE'`,
		movementID).
		Scan(&status, &costPtr, &cobPtr, &ccCostEnabled, &ccCobEnabled)
	if qErr != nil {
		return "", "", false, false, ErrMovementNotFound
	}
	if status != MovementStatusDraft {
		return "", "", false, false, ErrMovementNotDraft
	}
	if costPtr == nil || cobPtr == nil {
		return "", "", false, false, ErrArbitrajeClientsRequired
	}
	costClientID = strings.TrimSpace(*costPtr)
	cobClientID = strings.TrimSpace(*cobPtr)
	if costClientID == "" || cobClientID == "" {
		return "", "", false, false, ErrArbitrajeClientsRequired
	}
	return costClientID, cobClientID, ccCostEnabled, ccCobEnabled, nil
}
