#!/usr/bin/env bash
# Aplica todas las migraciones pendientes contra la base indicada en DATABASE_URL.
# Uso típico: migrar Postgres de Railway desde tu Mac con DATABASE_PUBLIC_URL.
#
#   export DATABASE_URL='…'   # solo en tu terminal; no pegar en chats
#   ./scripts/migrate-up-public-db.sh
#
# Requiere: golang-migrate (brew install golang-migrate)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: definí DATABASE_URL en el entorno (ej. DATABASE_PUBLIC_URL de Railway)." >&2
  echo "  export DATABASE_URL='postgresql://…'" >&2
  exit 1
fi

if ! command -v migrate >/dev/null 2>&1; then
  echo "ERROR: no se encontró 'migrate'. Instalá: brew install golang-migrate" >&2
  exit 1
fi

echo "==> migrate up (path=$ROOT/backend/migrations)"
migrate -path "$ROOT/backend/migrations" -database "$DATABASE_URL" up
echo "==> OK"
