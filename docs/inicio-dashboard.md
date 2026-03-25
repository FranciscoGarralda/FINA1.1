# Inicio: resumen del día

## Qué muestra la pantalla

| Métrica (UI) | Clave API | Origen en backend | Misma regla que Reportes |
|--------------|-----------|-------------------|---------------------------|
| Utilidad FX | `utilidad` | `reportes_service.go` → `computeFXUtility` | Sí (`GET /api/reportes`) |
| Comisiones / profit | `profit` | `computeProfit` → suma `profit_entries` por divisa, filtrado por `movements.date` | Sí |
| Gastos | `gastos` | `computeGastos` → `movement_lines` OUT, `movements.type = GASTO` | Sí |
| Neto (resultado) | `resultado` | `computeResultado` → por divisa: utilidad + profit − gastos | Sí |

## Endpoint

`GET /api/dashboard/daily-summary?date=YYYY-MM-DD`

- **Permiso:** `dashboard.view` (mismos roles que la ruta Inicio).
- **Comportamiento:** arma dos reportes de un solo día: `date` y el **día calendario anterior** (`date − 1`).
- **Respuesta:** `reference` = día elegido, `compare` = día anterior; incluye `definitions` con texto de trazabilidad.

Si `date` se omite, el servidor usa la fecha UTC actual (`time.Now().UTC()`), alineado al default de `GET /api/reportes`.

## Qué no es

- No sustituye el módulo **Reportes** (otros rangos y vistas por divisa).
- La **posición de caja** en Inicio sigue siendo `GET /api/cash-position` (permiso `cash_position.view`), solo en el bloque desplegable.

## Archivos relevantes

- `backend/internal/services/reportes_service.go` — cálculos compartidos, `DailySummary`.
- `backend/internal/http/dashboard_handler.go` — handler HTTP.
- `frontend/src/pages/InicioPage.tsx` — UI.
