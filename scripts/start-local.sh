#!/usr/bin/env bash
# Arranque local: Postgres (Docker) + migraciones + indica cómo levantar API y front.
# Requiere: Docker Desktop, golang-migrate (`brew install golang-migrate`), Go, Node.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: no se encontró 'docker'. Instalá Docker Desktop y abrilo." >&2
  exit 1
fi

if ! command -v migrate >/dev/null 2>&1; then
  echo "ERROR: no se encontró 'migrate'. Instalá: brew install golang-migrate" >&2
  exit 1
fi

echo "==> Levantando Postgres (docker compose)..."
docker compose up -d

echo "==> Esperando puerto 5432..."
for _ in $(seq 1 45); do
  if command -v nc >/dev/null 2>&1 && nc -z 127.0.0.1 5432 2>/dev/null; then
    break
  fi
  sleep 1
done

export DATABASE_URL="${DATABASE_URL:-postgres://fina:fina@127.0.0.1:5432/fina?sslmode=disable}"
echo "==> Migraciones..."
migrate -path "$ROOT/backend/migrations" -database "$DATABASE_URL" up

echo ""
echo "==> Base lista. En DOS terminales aparte:"
echo "    Terminal 1 API:  cd \"$ROOT/backend\" && go run ./cmd/api"
echo "    Terminal 2 front: cd \"$ROOT/frontend\" && npm run dev"
echo ""
echo "    Front suele ser http://localhost:5173  |  API http://localhost:8080"
