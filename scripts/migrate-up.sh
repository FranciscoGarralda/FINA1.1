#!/usr/bin/env bash
# Migraciones hacia arriba. Requiere golang-migrate instalado.
# Uso: export DATABASE_URL='...'   # copiar desde Railway → Postgres → Variables (no commitear)
#      ./scripts/migrate-up.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: definí DATABASE_URL en el entorno (URL de Postgres de Railway u otro entorno)." >&2
  echo "Ejemplo: export DATABASE_URL='postgres://...'" >&2
  exit 1
fi
exec migrate -path "$ROOT/backend/migrations" -database "$DATABASE_URL" up
