# Arqueos de caja (v1)

## Flujo

1. Usuario con `cash_arqueo.view` abre **Arqueos caja** y ve historial filtrable.
2. Usuario con `cash_arqueo.create` elige **cuenta**, **fecha de corte** (`as_of`, misma regla que posición de caja: movimientos con `date <= corte`).
3. El backend expone **saldo sistema por divisa** como suma **CASH + DIGITAL** (`ListAccountCurrencyTotals`), solo para divisas dadas de alta en la cuenta.
4. Se ingresa **conteo real** por divisa (total agregado; sin denominaciones en v1).
5. **POST** persiste cabecera + líneas con **snapshot** de sistema y `counted_total`; **diferencia** = conteo − snapshot (derivada en lectura y en respuesta de alta).
6. **Auditoría**: en la misma transacción, `audit_logs` con `entity_type = cash_arqueo`, acción `create`.

## API

| Método | Ruta | Permiso |
|--------|------|---------|
| GET | `/api/cash-arqueos?account_id=&from=&to=` | `cash_arqueo.view` |
| GET | `/api/cash-arqueos/system-totals?account_id=&as_of=` | `cash_arqueo.view` |
| POST | `/api/cash-arqueos` | `cash_arqueo.create` |

Roles por defecto: SUPERADMIN, ADMIN, SUBADMIN, OPERATOR (COURIER sin acceso).

## Archivos principales

- `backend/migrations/000014_cash_arqueos.up.sql` — tablas y permisos.
- `backend/internal/repositories/cash_position_repo.go` — `ListAccountCurrencyTotals`.
- `backend/internal/repositories/cash_arqueo_repo.go` — persistencia y listado.
- `backend/internal/services/cash_arqueo_service.go` — reglas de negocio, auditoría en tx.
- `backend/internal/http/cash_arqueo_handler.go` — HTTP.
- `frontend/src/pages/CashArqueosPage.tsx` — UI.

## Tests

- `backend/internal/services/cash_arqueo_service_test.go` — `DifferenceCountedMinusSystem`.
