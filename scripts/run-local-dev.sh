#!/usr/bin/env bash
# Levanta Postgres (Docker), API (:8080) y Vite (:5173) en segundo plano.
# Uso (desde la raíz del repo): ./scripts/run-local-dev.sh
# Parar: kill "$(cat /tmp/fina-local-api.pid)" "$(cat /tmp/fina-local-front.pid)" 2>/dev/null || true
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

API_PID_FILE=/tmp/fina-local-api.pid
FRONT_PID_FILE=/tmp/fina-local-front.pid
API_LOG=/tmp/fina-local-api.log
FRONT_LOG=/tmp/fina-local-front.log

# Mata cualquier proceso que escuche en $1 (evita API viejo en :8080 cuando el PID guardado ya no existe).
free_port() {
  local port=$1
  if ! command -v lsof >/dev/null 2>&1; then
    return 0
  fi
  local pids
  pids=$(lsof -ti ":$port" -sTCP:LISTEN 2>/dev/null || true)
  if [[ -n "${pids:-}" ]]; then
    echo "==> Liberando puerto $port (evitar API/Vite viejo)…"
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
    sleep 1
  fi
}

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: no se encontró 'docker'. Abrí Docker Desktop e intentá de nuevo." >&2
  exit 1
fi

echo "==> Postgres (docker compose)..."
docker compose up -d

echo "==> Esperando 127.0.0.1:5432..."
for _ in $(seq 1 45); do
  if command -v nc >/dev/null 2>&1 && nc -z 127.0.0.1 5432 2>/dev/null; then
    break
  fi
  sleep 1
done

[[ -f "$API_PID_FILE" ]] && kill "$(cat "$API_PID_FILE")" 2>/dev/null || true
free_port 8080

echo "==> API en :8080 (log: $API_LOG)..."
nohup bash -c "cd \"$ROOT/backend\" && exec go run ./cmd/api" >>"$API_LOG" 2>&1 &
echo $! >"$API_PID_FILE"

echo "==> Esperando GET /health..."
ok=0
for _ in $(seq 1 45); do
  if curl -sf "http://127.0.0.1:8080/health" >/dev/null 2>&1; then
    echo "    API OK."
    ok=1
    break
  fi
  sleep 1
done

if [[ "$ok" -ne 1 ]]; then
  echo "ERROR: el API no respondió en /health. Revisá: $API_LOG" >&2
  exit 1
fi

if [[ ! -d "$ROOT/frontend/node_modules" ]]; then
  echo "==> npm ci (primera vez)..."
  (cd "$ROOT/frontend" && npm ci)
fi

[[ -f "$FRONT_PID_FILE" ]] && kill "$(cat "$FRONT_PID_FILE")" 2>/dev/null || true
free_port 5173

echo "==> Vite en :5173 (log: $FRONT_LOG)..."
nohup bash -c "cd \"$ROOT/frontend\" && exec npm run dev" >>"$FRONT_LOG" 2>&1 &
echo $! >"$FRONT_PID_FILE"

echo ""
echo "Listo:"
echo "  • Front:  http://localhost:5173"
echo "  • API:    http://localhost:8080/health"
echo "  • Logs:   $API_LOG  |  $FRONT_LOG"
echo "  • Parar:  kill \"\$(cat $API_PID_FILE)\" \"\$(cat $FRONT_PID_FILE)\""
echo ""

if command -v open >/dev/null 2>&1; then
  sleep 2
  open "http://localhost:5173" || true
fi
