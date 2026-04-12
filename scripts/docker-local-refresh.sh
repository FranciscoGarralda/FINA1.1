#!/usr/bin/env bash
# Refresca imagen y contenedor del API contra la DB local de docker-compose.
# Uso (desde la raíz del repo): bash scripts/docker-local-refresh.sh
# Opcional: NO_CACHE=1 bash scripts/docker-local-refresh.sh  → build --no-cache
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker no está instalado o no está en PATH." >&2
  exit 1
fi

ARGS=(compose --profile stack)
if [[ "${NO_CACHE:-}" == "1" ]]; then
  docker "${ARGS[@]}" build --no-cache api
else
  docker "${ARGS[@]}" build api
fi

docker "${ARGS[@]}" up -d db api

echo "Listo: DB + API (perfil stack) en http://127.0.0.1:8082 (mapeo host→8080 en contenedor)."
echo "Si usás Vite contra este API: en vite.config.ts proxy target 8082, o levantá solo DB y seguí con go run en :8080."
