# Prompt: Estado de CC / posiciones

## Objetivo

La pantalla **Estado de CC** debe listar **todos los clientes activos con cuenta corriente habilitada** (`clients.cc_enabled`, `clients.active`), no solo los que tienen algún `cc_balances.balance != 0`.

## Reglas

- Saldos por moneda: solo filas con balance distinto de cero (misma semántica operativa).
- Clientes CC sin saldo no nulo: aparecen con `balances: []` (tarjeta sin montos).
- Sin duplicar clientes; orden: apellido, nombre, código de moneda.
- **Backend manda:** la lógica vive en `CCRepo.ListBalances`; `GET /api/cc-balances` mantiene el mismo contrato JSON.

## Implementación de referencia

- `backend/internal/repositories/cc_repo.go` — `ListBalances`: `FROM clients` + `LEFT JOIN cc_balances` con `cb.balance != 0`, filtro `cc_enabled` y `active`.

## Verificación

- `cd backend && go test ./...`
- Manual: cliente con CC on y saldo 0 → debe listarse; con saldo ≠ 0 → listarse con montos.

## Fuera de alcance

- Incluir clientes con `cc_enabled = false`.
- Cambiar cómo se escriben `cc_balances` en operaciones (compra/venta, ajustes manuales, etc.).
