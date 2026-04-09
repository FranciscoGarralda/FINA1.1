# Arqueos de caja (v2 — por divisa y formato)

## Flujo

1. Usuario con `cash_arqueo.view` abre **Arqueos caja** y ve historial filtrable.
2. Usuario con `cash_arqueo.create` elige **cuenta**, **fecha de corte** (`as_of`, misma regla que posición de caja: movimientos con `date <= corte`).
3. El backend expone **saldo sistema por divisa y formato** (`CASH` / `DIGITAL`) mediante `ListAccountCurrencyFormatTotals`: una fila por combinación habilitada en `account_currencies` (`cash_enabled` / `digital_enabled`) para esa cuenta/moneda. Los montos coinciden con el ledger (líneas de movimiento con ese `format`).
4. Se ingresa **conteo real** por cada fila (divisa + formato).
5. **POST** persiste cabecera + líneas con **snapshot** de sistema, `format`, y `counted_total`; **diferencia** = conteo − snapshot (derivada en lectura y en respuesta de alta).
6. **Auditoría**: en la misma transacción, `audit_logs` con `entity_type = cash_arqueo`, acción `create`.

## Históricos (migración `000020_cash_arqueo_line_format`)

**Opción B (aplicada):** las líneas de arqueo existentes antes del upgrade recibieron `line_format = 'CASH'`. No había desglose real efectivo/digital en datos viejos; las filas históricas pueden verse solo como CASH aunque el conteo haya incluido ambos conceptos en la práctica operativa.

## API

| Método | Ruta | Permiso |
|--------|------|---------|
| GET | `/api/cash-arqueos?account_id=&from=&to=` | `cash_arqueo.view` |
| GET | `/api/cash-arqueos/system-totals?account_id=&as_of=` | `cash_arqueo.view` |
| POST | `/api/cash-arqueos` | `cash_arqueo.create` |

**GET system-totals** — `totals[]`: `currency_id`, `currency_code`, **`format`** (`CASH` \| `DIGITAL`), `balance`.

**POST** — `lines[]`: `currency_id`, **`format`**, `counted_total` (obligatorio; sin duplicar `(currency_id, format)` en el mismo arqueo).

Roles por defecto: SUPERADMIN, ADMIN, SUBADMIN, OPERATOR (COURIER sin acceso).

## Archivos principales

- `backend/migrations/000014_cash_arqueos.up.sql` — tablas y permisos base.
- `backend/migrations/000020_cash_arqueo_line_format.up.sql` — columna `line_format` y unicidad `(arqueo, divisa, formato)`.
- `backend/internal/repositories/cash_position_repo.go` — `ListAccountCurrencyFormatTotals` (y `ListAccountCurrencyTotals` legado agregado CASH+DIGITAL, no usado por arqueos).
- `backend/internal/repositories/cash_arqueo_repo.go` — persistencia y listado.
- `backend/internal/services/cash_arqueo_service.go` — reglas de negocio, auditoría en tx.
- `backend/internal/http/cash_arqueo_handler.go` — HTTP.
- `frontend/src/pages/CashArqueosPage.tsx` — UI.

## Tests

- `backend/internal/services/cash_arqueo_service_test.go` — `DifferenceCountedMinusSystem`, validación de líneas y duplicados `(divisa, formato)`.
