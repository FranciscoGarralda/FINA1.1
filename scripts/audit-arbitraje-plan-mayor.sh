#!/usr/bin/env bash
# Auditoría plan maestro (dimensión A + B en DB) — matriz ARB-A1..A6 vía API + psql.
# Requisitos: Postgres local (fina/fina), API en 127.0.0.1:8080, usuario e2e_browser (ver upsert-login-user).
# Uso: bash scripts/audit-arbitraje-plan-mayor.sh 2>&1 | tee /tmp/audit-arb.txt
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PGPASSWORD="${PGPASSWORD:-fina}"
PSQL_A=(psql -h 127.0.0.1 -U fina -d fina -tAc)
PSQL_T=(psql -h 127.0.0.1 -U fina -d fina)
BASE="${API_BASE:-http://127.0.0.1:8080}/api"

log() { printf '%s\n' "$*"; }

TOK=$(curl -s -X POST "$BASE/login" -H 'Content-Type: application/json' \
  -d '{"username":"e2e_browser","password":"Temp-E2E-2026!"}' | jq -r .token)
if [[ -z "$TOK" || "$TOK" == "null" ]]; then
  log "ERROR: login falló (¿existe usuario e2e_browser?)"
  exit 1
fi

CC_ID=$("${PSQL_A[@]}" "select id::text from clients where cc_enabled is true and active is true order by client_code limit 1;")
NOCC_ID=$("${PSQL_A[@]}" "select id::text from clients where cc_enabled is false and active is true limit 1;")
if [[ -z "$CC_ID" ]]; then
  log "ERROR: no hay cliente con CC en DB"
  exit 1
fi
if [[ -z "$NOCC_ID" ]]; then
  NOCC_ID=$("${PSQL_A[@]}" "insert into clients (first_name,last_name,phone,dni,address_street,address_number,address_floor,reference_contact,referred_by,cc_enabled,active)
    values ('Audit','SinCC','999','999','x','1','','','',false,true) returning id::text;")
  log "Insertado cliente sin CC: $NOCC_ID"
fi

ACC_ID=$("${PSQL_A[@]}" "select id::text from accounts where active is true order by name limit 1;")
CUR_ID=$("${PSQL_A[@]}" "select id::text from currencies where code='ARS' limit 1;")
if [[ -z "$ACC_ID" || -z "$CUR_ID" ]]; then
  log "ERROR: falta cuenta o divisa ARS"
  exit 1
fi

HDR_DATE="2026-05-10"
HDR_DAY="Domingo"

# Crea borrador ARBITRAJE, PATCH cabecera (cobrado = client principal), ejecuta POST arbitraje.
run_case() {
  local tag=$1 cost=$2 cob=$3 json=$4
  local mid patch resp
  mid=$(curl -s -X POST "$BASE/movements" -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
    -d "{\"type\":\"ARBITRAJE\",\"date\":\"$HDR_DATE\",\"day_name\":\"$HDR_DAY\",\"client_id\":null}" | jq -r .id)
  if [[ -z "$mid" || "$mid" == "null" ]]; then
    log "FAIL $tag: no movement id"
    return 1
  fi
  patch=$(curl -s -X PATCH "$BASE/movements/$mid/header" -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
    -d "{\"date\":\"$HDR_DATE\",\"type\":\"ARBITRAJE\",\"client_id\":\"$cob\",\"arbitraje_cost_client_id\":\"$cost\",\"arbitraje_cobrado_client_id\":\"$cob\",\"confirm_clear_payload\":false}")
  if ! echo "$patch" | jq -e .id >/dev/null 2>&1; then
    log "FAIL $tag PATCH: $patch"
    return 1
  fi
  resp=$(curl -s -X POST "$BASE/movements/$mid/arbitraje" -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d "$json")
  if ! echo "$resp" | jq -e .status >/dev/null 2>&1; then
    log "FAIL $tag EXEC: $resp"
    return 1
  fi
  echo "$mid"
}

snap() {
  local mid=$1 tag=$2
  log ""
  log "----- $tag movement_id=$mid -----"
  "${PSQL_T[@]}" -c "select m.type, m.status, m.client_id::text as header_cob, m.arbitraje_cost_client_id::text as ac, m.arbitraje_cobrado_client_id::text as ab from movements m where m.id='$mid'::uuid;"
  log "movement_lines:"
  "${PSQL_T[@]}" -c "select ml.side, c.code, ml.format, ml.amount::text, ml.is_pending from movement_lines ml join currencies c on c.id=ml.currency_id where ml.movement_id='$mid'::uuid order by ml.created_at, ml.id;"
  log "pending_items (join línea):"
  "${PSQL_T[@]}" -c "select pi.status, pi.type, pi.cc_apply_on_resolve, c.code, pi.amount::text, pi.client_id::text from pending_items pi join movement_lines ml on ml.id=pi.movement_line_id join currencies c on c.id=pi.currency_id where ml.movement_id='$mid'::uuid order by pi.created_at;"
  log "cc_entries:"
  "${PSQL_T[@]}" -c "select ce.client_id::text, cur.code, ce.amount::text, left(ce.note,80) from cc_entries ce join currencies cur on cur.id=ce.currency_id where ce.movement_id='$mid'::uuid order by ce.created_at;"
  log "profit_entries:"
  "${PSQL_T[@]}" -c "select pe.amount::text, pe.account_id::text from profit_entries pe where pe.movement_id='$mid'::uuid;"
}

J1=$(jq -n --arg acc "$ACC_ID" --arg cur "$CUR_ID" \
  '{costo:{account_id:$acc,currency_id:$cur,format:"CASH",amount:"100",pending_cash:false},
    cobrado:{account_id:$acc,currency_id:$cur,format:"CASH",amount:"105",pending_cash:false},
    profit:{account_id:$acc,currency_id:$cur,format:"CASH",amount:"5",manual_override:false}}')
M1=$(run_case "A1" "$CC_ID" "$CC_ID" "$J1")
snap "$M1" "ARB-A1"

log "=== ARB-A2 CC cobrado, IN pendiente CASH (tabla maestra: CC, no pending_items) ==="
J2=$(jq -n --arg acc "$ACC_ID" --arg cur "$CUR_ID" \
  '{costo:{account_id:$acc,currency_id:$cur,format:"CASH",amount:"50",pending_cash:false},
    cobrado:{account_id:$acc,currency_id:$cur,format:"CASH",amount:"60",pending_cash:true},
    profit:{account_id:$acc,currency_id:$cur,format:"CASH",amount:"10",manual_override:true}}')
M2=$(run_case "A2" "$CC_ID" "$CC_ID" "$J2")
snap "$M2" "ARB-A2"

log "=== ARB-A3 CC costo, OUT pendiente CASH ==="
J3=$(jq -n --arg acc "$ACC_ID" --arg cur "$CUR_ID" \
  '{costo:{account_id:$acc,currency_id:$cur,format:"CASH",amount:"40",pending_cash:true},
    cobrado:{account_id:$acc,currency_id:$cur,format:"CASH",amount:"55",pending_cash:false},
    profit:{account_id:$acc,currency_id:$cur,format:"CASH",amount:"15",manual_override:true}}')
M3=$(run_case "A3" "$CC_ID" "$CC_ID" "$J3")
snap "$M3" "ARB-A3"

log "=== ARB-A4 Sin CC, costo pendiente, cobrado spot ==="
J4=$(jq -n --arg acc "$ACC_ID" --arg cur "$CUR_ID" \
  '{costo:{account_id:$acc,currency_id:$cur,format:"CASH",amount:"30",pending_cash:true},
    cobrado:{account_id:$acc,currency_id:$cur,format:"CASH",amount:"38",pending_cash:false},
    profit:{account_id:$acc,currency_id:$cur,format:"CASH",amount:"8",manual_override:true}}')
M4=$(run_case "A4" "$NOCC_ID" "$NOCC_ID" "$J4")
snap "$M4" "ARB-A4"

log "=== ARB-A5 CC, profit negativo (pérdida) ==="
J5=$(jq -n --arg acc "$ACC_ID" --arg cur "$CUR_ID" \
  '{costo:{account_id:$acc,currency_id:$cur,format:"CASH",amount:"120",pending_cash:false},
    cobrado:{account_id:$acc,currency_id:$cur,format:"CASH",amount:"100",pending_cash:false},
    profit:{account_id:$acc,currency_id:$cur,format:"CASH",amount:"-20",manual_override:true}}')
M5=$(run_case "A5" "$CC_ID" "$CC_ID" "$J5")
snap "$M5" "ARB-A5"

log "=== ARB-A6 cierre transversal (A1): caja neta ARS CASH en líneas ==="
"${PSQL_A[@]}" "select coalesce(sum(case when ml.side='IN' then ml.amount::numeric else 0 end),0) - coalesce(sum(case when ml.side='OUT' then ml.amount::numeric else 0 end),0) from movement_lines ml where ml.movement_id='$M1'::uuid and ml.format='CASH';"

log ""
log "IDs generados: A1=$M1 A2=$M2 A3=$M3 A4=$M4 A5=$M5"
log "Auditoría DB completada."
