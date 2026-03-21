#!/usr/bin/env bash
# Revierte UNA migración (down 1). Solo entornos donde tengas claro el impacto.
# Uso: export DATABASE_URL='...'
#      ./scripts/migrate-down.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: definí DATABASE_URL en el entorno." >&2
  exit 1
fi
echo "ADVERTENCIA: se aplicará migrate down 1 (revertir una migración)." >&2
read -r -p "¿Continuar? [s/N] " x || exit 1
case "$x" in
  [sS]) ;;
  *) echo "Cancelado." >&2; exit 1 ;;
esac
exec migrate -path "$ROOT/backend/migrations" -database "$DATABASE_URL" down 1
