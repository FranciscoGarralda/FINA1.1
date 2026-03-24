# Export CSV de movimientos CC (compartir)

## Endpoint

`GET /api/cc-entries/export.csv`

- **Permiso:** `cc.export_csv` (roles con acceso típico: SUPERADMIN, ADMIN, SUBADMIN, OPERATOR; COURIER no).
- **Query obligatoria:** `client_id` (UUID), `from`, `to` en formato `YYYY-MM-DD`.
- **Filtro temporal:** fecha de **operación** del movimiento (`movements.date`), inclusive entre `from` y `to`.
- **Alcance de filas:** solo registros de `cc_entries` del cliente indicado (todas las divisas). No se incluyen `movement_lines` ni datos de contrapartes u otras cuentas.

## Límites

- Rango máximo **732 días** (inclusive `from`–`to`).
- Respuesta: CSV con BOM UTF-8, `Content-Disposition: attachment`.

## Columnas exportadas (lista cerrada)

| Columna            | Origen / significado                                      |
|--------------------|-----------------------------------------------------------|
| `fecha_asiento_cc` | `cc_entries.created_at` (RFC3339 UTC)                     |
| `fecha_operacion`  | `movements.date`                                          |
| `tipo_operacion`   | `movements.type`                                          |
| `numero_operacion` | `movements.operation_number` (vacío si es null)           |
| `divisa`           | código de moneda (`currencies.code`)                      |
| `monto_cc`         | `cc_entries.amount` (texto numérico; convención OUT− / IN+) |
| `nota`             | `cc_entries.note`                                         |

## Qué no incluye este export

- Líneas de movimiento, cuentas, clientes contraparte, FX aplicado en detalle, pendientes.
- Cualquier agregado distinto al asiento CC del cliente en cuestión.

## Arbitraje y operaciones multiparte

Una operación puede tener varios impactos en distintos clientes o divisas. Este CSV **solo** lista las filas `cc_entries` del `client_id` solicitado. Para reconstruir el contexto completo de la operación hay que usar `tipo_operacion` y `numero_operacion` contra el sistema autorizado; no se exponen aquí los asientos CC de otros actores.
