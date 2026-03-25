#!/usr/bin/env bash
# Ejecuta reset-operational-data.sql contra la base indicada por DATABASE_URL.
# Uso (solo en tu máquina, tras backup):
#   export DATABASE_URL='postgres://...'
#   ./scripts/run-reset-operational-data.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL="$ROOT/scripts/reset-operational-data.sql"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: definí DATABASE_URL (Railway → Postgres → Variables). No la pegues en el repo." >&2
  exit 1
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: falta psql (ej. brew install libpq y agregar libpq/bin al PATH)." >&2
  exit 1
fi
if [[ ! -f "$SQL" ]]; then
  echo "ERROR: no se encuentra $SQL" >&2
  exit 1
fi

echo "Se borrarán clientes, movimientos, CC, pendientes, arqueos y audit_logs."
read -r -p "Escribí RESET en mayúsculas para continuar: " confirm
if [[ "$confirm" != "RESET" ]]; then
  echo "Cancelado." >&2
  exit 1
fi

exec psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$SQL"
