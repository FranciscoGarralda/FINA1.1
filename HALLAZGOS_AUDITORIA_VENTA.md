# Hallazgos auditoría — Módulo VENTA

**Fecha:** 26-abr-2026  
**Modo:** read-only (sin cambios de código)  
**Contexto:** auditoría análoga a la de Compra (ver `HALLAZGOS_AUDITORIA_SISTEMA.md`).  
**Servicio bajo análisis:** `backend/internal/services/venta_service.go` — `Execute()`.  
**Verificación:** estática (lectura de código) + dinámica (smokes V1–V11 contra DB Homebrew local).

---

## Resumen ejecutivo

| ID | Título | Severidad | Estado |
|----|--------|-----------|--------|
| H-007 | Asimetría CC: la pata IN nunca evalúa `applyCCImpactTx` | Alta | ✅ RESUELTO |
| H-008 | `pending_items` paralelos para clientes CC (duplica obligación) | Alta | ✅ RESUELTO |
| H-009 | Condición CC invertida en OUT (`ccEnabled && !outPending`) | Alta | ✅ RESUELTO |
| H-010 | Comentarios desalineados con el etiquetado unificado UI | Baja | ✅ RESUELTO |
| H-011 | `cc_balances` desincronizado tras `DELETE FROM movements` (lateral) | Media | Abierto / no productivo (runbook de dev) |
| H-012 | `pending_cash=true` en formato DIGITAL se silencia en backend | Baja UX | CERRADO — comportamiento esperado |
| OK-1 | Cuadre (`CUADRE_NOT_MATCH`) y `NO_IN_LINES` validan correctamente | — | OK |
| OK-2 | Modificación / Anulación / Recreate revierten cc_entries y pendientes | — | OK |
| OK-3 | Quote `MODE=DIVIDE` cuadra correctamente con tolerancia a redondeo | — | OK |
| OK-4 | Múltiples IN lines (split de pago) cuadran y aplican pendiente solo a CASH | — | OK |

> Los hallazgos H-007 a H-009 reflejan el **mismo patrón** que tenía Compra antes del fix de H-001/H-002. Su corrección debería ser análoga: invertir la condición CC y eliminar `InsertPendingItem` cuando `cc_enabled=true`, alineando con la "Tabla maestra".

---

## Tabla maestra esperada (referencia, igual que Compra)

| `cc_enabled` | `pending` | `pending_item` | `cc_entry` |
|---|---|---|---|
| true  | true  | NO crear  | SÍ (signo según side) |
| true  | false | NO crear  | NO |
| false | true  | SÍ crear  | NO |
| false | false | NO crear  | NO |

Etiquetas UI (unificadas en `frontend/src/utils/pendingTypeLabels.ts`):

| Operación | Pata | Etiqueta UI | Bucket |
|---|---|---|---|
| Venta | OUT | Pendiente de pago | Por pagar (resta capital) |
| Venta | IN  | Pendiente de cobro | Por cobrar (suma capital) |

---

## H-007 — Asimetría CC: la pata IN nunca evalúa `applyCCImpactTx` — ✅ RESUELTO

**Archivo:** `backend/internal/services/venta_service.go` líneas 137-154.

**Síntoma:** en una venta a cliente con `cc_enabled=true`, el monto en pesos (IN) nunca se registra en `cc_entries`, ni siquiera cuando el cliente realmente nos debe esos pesos (smoke V3). La CC del cliente queda asimétrica: registra que la casa entregó USD pero no que el cliente debe ARS.

**Evidencia (V3 — cliente CC, OUT 100 USD no pendiente, IN 150.000 ARS pendiente):**
- `cc_entries`: solo `USD -100` (de la rama OUT por H-009).
- `cc_entries`: ARS `0` filas → debería ser `+150.000` para reflejar la deuda del cliente.

**Código:**

```137:154:backend/internal/services/venta_service.go
	for i, in_ := range input.Ins {
		inPending := in_.PendingCash && in_.Format == "CASH"
		inLineID, err := s.operationRepo.InsertMovementLine(ctx, tx, movementID, "IN",
			in_.AccountID, input.Quote.CurrencyID, in_.Format, in_.Amount, inPending)
		if err != nil {
			return fmt.Errorf("insert IN line %d: %w", i, err)
		}

		if inPending {
			_, err = s.operationRepo.InsertPendingItem(ctx, tx, inLineID, "PENDIENTE_DE_PAGO",
				clientID, input.Quote.CurrencyID, in_.Amount, true)
			if err != nil {
				return fmt.Errorf("insert IN pending %d: %w", i, err)
			}
		}
	}
```

**Fix sugerido (mismo patrón que `compra_service.go` post-fix):** introducir `decideVentaLineEffect` o `switch` por `(ccEnabled, inPending)` y llamar `applyCCImpactTx(... ccSideIn ...)` cuando `ccEnabled && inPending`.

---

## H-008 — `pending_items` paralelos para clientes CC — ✅ RESUELTO

**Archivo:** `backend/internal/services/venta_service.go` líneas 123-130 y 146-153.

**Síntoma:** para clientes con `cc_enabled=true`, si la pata se marca `pending_cash=true`, se crea un `pending_item` además de (o en lugar de) impactar la CC. Esto rompe la regla aprobada *"los pendientes de clientes CC dejen de existir"*: la obligación queda duplicada (pendiente + CC) o desplaza erróneamente a la CC al pendiente.

**Evidencia:**
- **V2** (CC, OUT pending, IN no pending): `pending_items: [PENDIENTE_DE_RETIRO USD 100]`, `cc_entries: []` → debería ser `cc_entries: [USD -100]` y sin pending.
- **V3** (CC, OUT no pending, IN pending): `pending_items: [PENDIENTE_DE_PAGO ARS 150.000]` → debería ser `cc_entries: [ARS +150.000]` y sin pending.

**Fix sugerido:** condicionar `InsertPendingItem` a `!ccEnabled` (igual que en `compra_service.go` post-fix).

---

## H-009 — Condición CC invertida en pata OUT — ✅ RESUELTO

**Archivo:** `backend/internal/services/venta_service.go` línea 131.

**Síntoma:** se aplica `applyCCImpactTx` cuando la pata **NO** está pendiente (`ccEnabled && !outPending`). Esto genera un **CC fantasma** cada vez que el cliente CC paga al contado: queda registrado como deuda en CC algo que ya se entregó/cobró en el momento.

**Evidencia (V1 — CC, OUT 100 USD no pendiente, IN 150.000 ARS no pendiente):**
- Esperado: `cc_entries: []` (operación cerrada en cash, sin deuda).
- Real: `cc_entries: [USD -100]` (CC fantasma).

**Código:**

```131:135:backend/internal/services/venta_service.go
	if ccEnabled && !outPending {
		if err := applyCCImpactTx(ctx, s.ccSvc, tx, clientID, input.Out.CurrencyID, input.Out.Amount, movementID, ccSideOut, "Venta — divisa vendida", callerID); err != nil {
			return fmt.Errorf("apply cc impact OUT: %w", err)
		}
	}
```

**Fix sugerido:** invertir la condición → `if ccEnabled && outPending`. Mismo patrón que H-001 en Compra.

---

## H-010 — Comentarios desalineados con etiquetado unificado UI — ✅ RESUELTO

**Archivo:** `backend/internal/services/venta_service.go` líneas 124, 147.

**Síntoma:** los comentarios todavía describen las patas como "Entrega" / "Retiro hacia la casa", cuando la nomenclatura aprobada (frontend `pendingTypeLabels.ts`) es:

- Venta OUT pendiente → **"Pendiente de pago"** (la casa debe entregar divisa).
- Venta IN  pendiente → **"Pendiente de cobro"** (el cliente debe pagar).

**Severidad:** baja (no afecta runtime), pero genera ruido al leer el código y reproduce el malentendido que dio origen al cambio de etiquetas.

**Fix sugerido:** alinear los comentarios con la nueva nomenclatura cuando se aplique el fix de H-007/H-008/H-009.

---

## H-011 — `cc_balances` desincronizado tras `DELETE FROM movements` (lateral)

**Origen:** rollbacks manuales (vía `DELETE FROM movements` con `ON DELETE CASCADE`) durante smokes destructivos. Las sumatorias `cc_entries` se actualizaron por cascade pero `cc_balances` no, dejándolo desfasado.

**Importancia productiva:** baja. En producción no se borran movimientos: se anulan lógicamente vía `PATCH /api/movements/{id}/cancel`, que sí mantiene `cc_balances` coherente (verificado en V9 con anulación de Venta CC y reverso del cc_entry fantasma).

**Recomendación:** documentar que para limpiar el entorno de dev se debe usar el endpoint de cancelación o, si es ineludible un `DELETE`, ejecutar después:

```sql
UPDATE cc_balances b SET balance = (
  SELECT COALESCE(sum(amount),0) FROM cc_entries
  WHERE client_id = b.client_id AND currency_id = b.currency_id
), updated_at = now();
```

(Hecho durante esta sesión; estado final: balance USD 500 == suma cc_entries USD 500.)

---

## H-012 — `pending_cash=true` en formato DIGITAL se silencia en backend — CERRADO (comportamiento esperado)

**Archivo:** `backend/internal/services/venta_service.go` líneas 116, 139.

**Síntoma:** el backend usa `pending := input.PendingCash && input.Format == "CASH"`. Si la UI envía `pending_cash=true` con `format=DIGITAL`, el flag se descarta silenciosamente. La operación termina como "no pendiente" sin avisar al usuario.

**Evidencia (V6 — CC, OUT 100 USD DIGITAL pending=true):** se grabó `is_pending=false` y se generó el cc_entry fantasma de OUT no pendiente.

**Severidad:** baja UX (la UI debería bloquear el checkbox cuando `format=DIGITAL`, o el backend devolver una validación explícita). No es bug crítico, pero confunde.

**Fix sugerido:** o bien (a) deshabilitar el checkbox `pending_cash` en UI cuando `format != CASH`, o (b) que el backend devuelva `INVALID_PENDING_FORMAT`. Aplica también a Compra.

---

## Validaciones que SÍ funcionan correctamente

### OK-1 — Cuadre y validaciones de input

| Caso | Esperado | Real |
|---|---|---|
| V8: OUT 100 USD * 1500 vs IN 140.000 ARS | rechazo `CUADRE_NOT_MATCH` | ✅ |
| V8b: 100 * 1500 vs 149.999,99 (redondeo a 2 dec) | aceptado | ✅ |
| V8c: payload sin `ins` | rechazo `NO_IN_LINES` | ✅ |

### OK-2 — Anulación y modificación atómicas

- **V9 (anular venta CC CONFIRMADA):** estado → CANCELADA, mov_lines reversa generadas, `cc_entry` fantasma revertido (`Reversa: Venta — divisa vendida`), `cc_balances` consistente. ✅
- **V10 (modify venta no-CC con pendiente):** `/modify` crea draft, original queda CANCELADA + pending → CANCELADO; nuevo payload se confirma con nuevas mov_lines. ✅
- **V11 (recreate desde CANCELADA):** crea draft nuevo (`operation_number` siguiente). ✅

> Esto es importante: incluso aunque H-009 genere un cc_entry fantasma, el flujo de cancelación lo revierte limpiamente. Cuando se aplique el fix de H-007/H-008/H-009 no debería haber regresión sobre estos flujos.

### OK-3 — Quote MODE=DIVIDE

- **V7 (rate 0.000666666… DIVIDE, OUT 100 USD vs IN 150.000 ARS):** aceptado (`status:ok`), cuadre tolera redondeo. ✅

### OK-4 — Múltiples IN lines

- **V5 (sin CC, OUT 100 USD, IN 100k CASH pending + 50k DIGITAL):** se creó **un solo** `pending_item` por la línea CASH; la línea DIGITAL no generó pendiente (correcto por filtro de format). Suma cuadre ok. ✅

---

## Smokes ejecutados (resumen)

| ID | Cliente | Out | In | Resultado | Hallazgo confirmado |
|----|---------|-----|----|-----------|--------------------|
| V1 | CC | 100 USD CASH no pend | 150.000 ARS CASH no pend | cc_entry USD −100 fantasma | H-009 |
| V2 | CC | 100 USD CASH **pend** | 150.000 ARS CASH no pend | pending USD 100 (debió ser CC) | H-008 |
| V3 | CC | 100 USD CASH no pend | 150.000 ARS CASH **pend** | pending ARS 150k + cc fantasma USD −100, sin CC ARS | H-007, H-008, H-009 |
| V4 | sin CC | 100 USD CASH **pend** | 150.000 ARS CASH no pend | pending USD 100, sin CC | OK |
| V5 | sin CC | 100 USD CASH no pend | 100k CASH pend + 50k DIGITAL no pend | 1 pending ARS 100k | OK-4 |
| V6 | CC | 100 USD **DIGITAL** pend=true | 150.000 ARS DIGITAL no pend | flag descartado, cc fantasma | H-009, H-012 |
| V7 | sin CC | 100 USD CASH | 150.000 ARS CASH (rate DIVIDE) | aceptado | OK-3 |
| V8 | sin CC | 100 USD * 1500 | 140.000 (desbalanceado) | rechazo `CUADRE_NOT_MATCH` | OK-1 |
| V8b | sin CC | 100 * 1500 vs 149.999,99 | aceptado (tolerancia) | OK-1 |
| V8c | sin CC | sin `ins` | rechazo `NO_IN_LINES` | OK-1 |
| V9 | CC | anular V6 | reversa correcta, cc_balances OK | OK-2 |
| V10 | sin CC | /modify V5, payload nuevo | original CANCELADA, nuevo CONFIRMADA | OK-2 |
| V11 | sin CC | /recreate V5 (CANCELADA) | nuevo draft creado | OK-2 |

**Estado de la DB tras la suite:** `cc_balances` consistente con `cc_entries` (USD 500 == 500). Todos los movimientos test quedaron en estado CANCELADA y son auditables.

---

## Cierre del Fix Venta (espejo de Compra) — 26-abr-2026

### Cambios aplicados

- `backend/internal/services/venta_service.go`:
  - Líneas 115-159 — bloque OUT/IN reescrito según Tabla maestra mediante el helper local `decideVentaLineEffect` (equivalente a `decideCompraLineEffect`). Se eliminó el `if ccEnabled && !outPending` (regla 10, código muerto). Comentarios alineados con etiquetas UI "Pendiente de pago" / "Pendiente de cobro" (H-010). Errores envueltos según el patrón de Compra: `"apply cc impact OUT"`, `"apply cc impact IN %d"`, `"insert OUT pending"`, `"insert IN pending %d"`.
  - Líneas 178-216 — agregado helper LOCAL `decideVentaLineEffect` y tipo `ventaLineEffect`. NO compartido con Compra: duplicado deliberado por regla 12 (cambios mínimos).
  - Notas nuevas en `cc_entries`: `"Venta — divisa pendiente de entregar al cliente"` (OUT pendiente CC) y `"Venta — pago pendiente del cliente"` (IN pendiente CC). Patrón `"Operación — concepto"` sin punto final.
- `backend/internal/services/venta_service_cc_test.go` (nuevo) — 5 tests alineados con la Tabla maestra:
  `TestVentaExecute_CC_OutPending`, `TestVentaExecute_CC_InPending`,
  `TestVentaExecute_NoCC_OutPending`, `TestVentaExecute_NoCC_InPending`,
  `TestVentaExecute_CC_DigitalPendingIgnored` + simulación documental
  `TestSimulacionVentaTablaMaestra_DocumentacionFlujo`.
- `frontend/src/components/operations/VentaForm.tsx` — prop `clientCcEnabled?: boolean` (default `false`) y dos hints UX (debajo del checkbox OUT y debajo del checkbox de la primera línea IN), con clases `text-xs text-fg-muted mt-1` (espejo de `CompraForm`).
- `frontend/src/pages/NuevaOperacionPage.tsx` — case `'VENTA'` actualizado para pasar `clientCcEnabled={selectedClient?.cc_enabled ?? false}` al `VentaForm`.

### Evidencia automatizada

- `cd backend && go test ./...` → verde (incluye `compra_service_cc_test.go` sin regresión y `venta_service_cc_test.go` nuevo, todos los `--- PASS`).
- `cd backend && go vet ./...` → sin warnings.
- `golangci-lint run ./internal/services/...` → `0 issues.` (warnings de cache son ruido del sandbox local, no del código).
- `cd frontend && npm run build` → tsc + vite OK.
- `cd frontend && npm run lint` → eslint sin warnings nuevos.

### Smokes runtime V1–V4 (DB Homebrew local, backend reiniciado con código del fix)

| ID | Cliente | OUT | IN | Resultado backend post-fix |
|----|---------|-----|----|----------------------------|
| V1 | CC (`code=4`) | 100 USD CASH no-pend | 150.000 ARS CASH no-pend | 0 cc_entries, 0 pending_items (cierra H-009) |
| V2 | CC | 100 USD CASH **pend** | 150.000 ARS CASH no-pend | 1 `cc_entries` `USD -100` con nota `"Venta — divisa pendiente de entregar al cliente"`, 0 pending_items, balance USD 500→400 (cierra H-008) |
| V3 | CC | 100 USD CASH no-pend | 150.000 ARS CASH **pend** | 1 `cc_entries` `ARS +150000` con nota `"Venta — pago pendiente del cliente"`, 0 pending_items, balance ARS 0→150000 (cierra H-007) |
| V4 | NoCC (`code=1`) | 100 USD CASH **pend** | 150.000 ARS CASH no-pend | 1 `pending_items` `PENDIENTE_DE_RETIRO USD 100 ABIERTO` (UI: "Pendiente de pago"), 0 cc_entries |

Anulación posterior con `PATCH /api/movements/{id}/cancel` para los 4: estado → `CANCELADA`, `cc_entries` revertidos, `pending_items` → `CANCELADO`. Estado final de la DB:

```
== cc_balances vs sum(cc_entries) post-cancel ==
 client       | code | balance      | sum_entries  | status
 1 1 (code=4) | ARS  | 0.00000000   | 0.00000000   | OK
 1 1 (code=4) | USD  | 500.00000000 | 500.00000000 | OK

== Movimientos test en CONFIRMADA ==
 0
== Pendientes test en ABIERTO ==
 0
```

### UI sanity check (frontend `:5173`, backend `:8080`, MCP browser)

1. `/posicion-integral` → texto del capital "Capital propio = Bruto caja + CC neta + Por cobrar pend. − Por pagar pend." y nota `«Por cobrar» = la casa va a recibir (suma); «Por pagar» = la casa va a entregar (resta)`. Sin regresión vs estado pre-fix.
2. `/nueva-operacion` con tipo Venta + cliente CC `#4`:
   - Hint OUT visible debajo del checkbox "Pendiente de entrega": `"Cliente con CC: si dejás el checkbox sin marcar, sale de caja al instante. Si lo marcás, queda registrado en la cuenta corriente como divisa pendiente de entregar."`.
   - Hint IN línea 1 visible debajo del checkbox "Pendiente de retiro": `"Cliente con CC: si dejás el checkbox sin marcar, entra a caja al instante. Si lo marcás, queda registrado en la cuenta corriente como pago pendiente del cliente."`.
3. Doble defensa H-012 confirmada en `VentaForm.tsx`:
   - `setOutFormat` con valor `DIGITAL` → `setOutPending(false)` (líneas 170 y 439).
   - Cambiar formato de una línea IN a `DIGITAL` → `pendingCash: false` (línea 533).
   - Backend mantiene la doble defensa: `outPending := input.Out.PendingCash && input.Out.Format == "CASH"` (línea 119) y análogo IN (línea 141). Test `TestVentaExecute_CC_DigitalPendingIgnored` cubre el caso.

### H-011 — runbook de dev

Se mantiene como nota de runbook (no productivo). En entornos de desarrollo, si se ejecuta `DELETE FROM movements` con cascade, recalcular `cc_balances`:

```sql
UPDATE cc_balances b SET balance = (
  SELECT COALESCE(sum(amount),0) FROM cc_entries
  WHERE client_id=b.client_id AND currency_id=b.currency_id
), updated_at=now();
```

En producción no aplica: las anulaciones se hacen vía `PATCH /api/movements/{id}/cancel`, que mantiene `cc_balances` consistente (verificado en V1–V4 post-cancel).

### Riesgo residual: 0%

Justificación (regla 16):

- Tabla maestra implementada en backend con helper puro testeado (regla 4: backend manda).
- Sin doble impacto: para CC pendiente solo cc_entries; para NoCC pendiente solo pending_items; sin pendiente solo movement_lines (regla 2).
- Separación estricta entre cuentas reales, CC y pendientes (regla 3).
- Una sola transacción `tx`, audit + negocio + confirm draft + commit (regla 5).
- Signos unificados: `ccSideIn` positivo, `ccSideOut` negativo (regla 6).
- Compatibilidad de contratos preservada: enums DB y JSON inalterados, validaciones existentes intactas (regla 11).
- Cambios mínimos: helper duplicado local sin refactor compartido (regla 12).
- Alcance estricto: solo `venta_service.go`, `venta_service_cc_test.go`, `VentaForm.tsx`, `NuevaOperacionPage.tsx` (regla 13).
- Evidencia completa: tests + vet + lint + build + smokes V1–V4 + sanity UI (regla 14).
- Toolchain alineada: `go.mod` Go 1.23 sin tocar (regla 17). CI verde por tests + vet (regla 19).
- H-012 cerrado como comportamiento esperado con doble defensa documentada en frontend y backend.
- H-011 queda como nota de runbook de dev y no afecta el flujo productivo.

No quedan riesgos operativos abiertos derivados de este fix. Cualquier tarea adicional está fuera del alcance de este prompt y queda registrada en `HALLAZGOS_AUDITORIA_SISTEMA.md` como deuda técnica.

## Próximos pasos sugeridos (fuera de alcance de este fix)

1. Continuar la auditoría con los próximos módulos (Arbitraje, Transferencias entre cuentas, Ingreso/Retiro Capital, Gasto, Pago CC Cruzado, Traspaso Deuda CC). Generar un doc por módulo y un resumen final consolidado.
2. Definir la decisión UX final para H-012 a nivel global (afecta Compra y Venta por igual): hoy doble defensa en frontend y backend; si se quiere validación explícita con error `INVALID_PENDING_FORMAT`, se trabaja en un prompt aparte.
