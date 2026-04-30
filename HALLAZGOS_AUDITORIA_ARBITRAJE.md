# Hallazgos auditoría — Módulo ARBITRAJE

**Fecha:** 2026-04-29  
**Modo:** read-only (sin cambios de código)  
**Plan de referencia:** `AUDITORIA_PLAN_MAESTRO.md` (criterios **A** regla de negocio + **B** impacto en libros/pantallas).  
**Servicio bajo análisis:** `backend/internal/services/arbitraje_service.go` — `Execute()`.  
**UI:** `frontend/src/components/operations/ArbitrajeForm.tsx`.  
**Verificación:** estática (lectura de código) + **E2E UI** (2026-04-29). **Smokes de datos** propuestos al final para casos ARB-A2..A6.  
**E2E UI (plan maestro § 1.2):** ejecutado — ver sección **E2E UI** más abajo (login FG, Arbitraje ARB-A1, **ANTES/DESPUÉS** en `/posicion-caja`, `/posicion-integral` y `/posiciones`).

**Relación con:** `HALLAZGOS_AUDITORIA_ARBITRAJE_TRANSFERENCIA.md` (H-017..H-019 ya registrados; este documento **profundiza** solo Arbitraje y alinea con el plan maestro).

---

## Resumen ejecutivo

| ID | Título | Severidad | Estado |
|----|--------|-----------|--------|
| H-017 | Cliente CC + patas pendientes: siguen creándose `pending_items` (no aplica tabla maestra Compra/Venta) | 🟠 Alto | Abierto — decisión de producto pendiente |
| H-018 | No hay `applyCCImpactTx` sobre la pata **costo (OUT)** (solo cobrado no pendiente + profit) | 🟠 Alto | Abierto — coherencia con § 2 del plan |
| H-019 | `cc_apply_on_resolve`: costo `false`, cobrado `true` → asimetría al resolver | 🟡 Medio | Abierto |
| H-023 | **Profit:** con `cc_enabled`, ganancia/pérdida siempre impacta CC si hay línea IN/OUT de profit (sin condición “pendiente” en profit) | 🟡 Medio | Revisar — puede ser correcto por negocio |
| H-024 | **DIGITAL + pending:** mismo patrón que Compra/Venta (`PendingCash && CASH`); pendiente en DIGITAL se ignora | 🟢 Bajo | Alineado con H-012 |
| OK-A | Validaciones de monto, formato, profit obligatorio, tipo ARBITRAJE, borrador | — | OK en lectura |
| OK-B | `profit_entries` y líneas de profit coherentes con signo del profit | — | OK en lectura |

---

## Tabla maestra del plan maestro vs Arbitraje actual

El plan maestro § 2.1 está **cerrado** para **Compra** y **Venta** (`decideCompraLineEffect` / `decideVentaLineEffect`). **Arbitraje no implementa** ese patrón:

| `cc_enabled` | Pata pendiente (CASH) | Plan maestro (Compra/Venta) | Arbitraje hoy |
|:--:|:--:|:--|:--|
| Sí | Sí | `cc_entries`, **sin** `pending_items` | `pending_items` **sí**; **sin** CC en esa pata al confirmar |
| Sí | No | Sin `cc_entry` en esa pata | Cobrado: **sí** CC si no pendiente; Costo: **nunca** CC |

**Conclusión dimensión B:** el impacto **no** cae en los mismos libros que en Compra/Venta para cliente CC con checkbox pendiente → **incoherencia de producto** hasta que se defina excepción explícita (“Arbitraje es distinto porque…”).

---

## Semántica de patas (negocio)

| Pata | Línea | Pending backend | `pending_item` si aplica | CC al confirmar (`cc_enabled`) |
|------|-------|-----------------|---------------------------|--------------------------------|
| **Costo** | OUT | `costoPending` | `PENDIENTE_DE_PAGO` | **Nunca** |
| **Cobrado** | IN | `cobradoPending` | `PENDIENTE_DE_RETIRO` | Solo si `!cobradoPending` → `ccSideIn`, nota *Arbitraje — cobrado* |
| **Profit** | IN si > 0, OUT si < 0 | (no hay flag pendiente en input) | — | Si `ccEnabled` y profit ≠ 0 → `ccSideIn` / `ccSideOut` según signo |

**Observación:** “Cobrado” es dinero **entrante** a la cuenta elegida; el CC usa `ccSideIn` como en flujos “recibimos”. Coherente con `signedCCAmount` **si** la interpretación es “reduce deuda del cliente / entrega a la casa”. Validación con smokes y saldo inicial sigue siendo obligatoria (plan maestro § 6 paso 5).

---

## H-017 — `pending_items` con cliente CC (reconfirmación)

**Dimensión A:** el backend acepta la operación y crea líneas + pendientes según flags.  
**Dimensión B:** para `cc_enabled=true` y `costoPending` o `cobradoPending`, se llama a `InsertPendingItem` **sin** condicionar `!ccEnabled` (líneas 122-127, 137-142).

**Archivo:** `arbitraje_service.go` 122-142.

---

## H-018 — Ausencia de CC en **costo (OUT)**

**Dimensión A:** no hay bug de sintaxis; es un hueco funcional.  
**Dimensión B:** cualquier costo pagado o pendiente **no** genera `cc_entries` por esa pata. Solo cobrado (real) y profit afectan CC.

**Contraste:** `transferencia_service` impacta OUT e IN cuando son REAL (plan maestro y HALLAZGOS sistema histórico). **Decisión de negocio:** ¿el arbitraje debe reflejar en CC el desembolso de costo vinculado al cliente o solo resultado + cobrado?

**Archivo:** `arbitraje_service.go` 115-128 (costo sin `applyCCImpactTx`).

---

## H-019 — `cc_apply_on_resolve` asimétrico

- Costo pendiente: último argumento `InsertPendingItem` = **`false`** (línea 123).  
- Cobrado pendiente: **`true`** (línea 138).

**Dimensión B:** al resolver en `PendingService`, el costo pendiente **no** disparará CC diferida; el cobrado pendiente **sí** (si el cliente sigue con CC al resolver). Riesgo de **asimetría** en el cierre operativo.

**Archivo:** `arbitraje_service.go` 122-124, 137-139.

---

## H-023 — CC en **profit** (ganancia / pérdida)

Con `ccEnabled` y profit > 0 o < 0, siempre se aplica CC sobre el monto absoluto del profit (líneas 165-183). No existe “profit pendiente” en el DTO.

**Dimensión A:** coherente internamente (ganancia IN → `ccSideIn`, pérdida OUT → `ccSideOut`).  
**Dimensión B:** suma efectos CC **además** del cobrado CC. ¿El cliente debe ver en CC tanto el “cobrado” como la “ganancia de mesa” por separado? Es **válido** si el negocio define que el profit es comisión atribuible al cliente; si no, podría haber **doble lectura** en la misma operación.

**Estado:** no es bug automático; requiere **confirmación de negocio** + smoke con balances.

---

## H-024 — DIGITAL + pendiente (consistencia con H-012)

`costoPending := input.Costo.PendingCash && input.Costo.Format == "CASH"` (línea 116). Igual para cobrado (131). Comportamiento alineado con Compra/Venta: pendiente solo CASH.

---

## Validaciones OK (lectura de código)

- Montos costo/cobrado > 0; profit parseable; cuenta/currency profit obligatorias; formatos CASH/DIGITAL en patas y profit.
- Movimiento debe ser `ARBITRAJE` y `BORRADOR`.
- Audit trail `arbitraje` con montos y divisas.
- Confirmación vía `confirmMovementDraftTx` al final.

---

## Frontend (`ArbitrajeForm.tsx`)

- Envía `pending_cash` por pata (`costoPending`, `cobradoPending`) al confirmar (ver payload hacia `/movements/{id}/arbitraje`).
- **Dimensión B (UI):** conviene verificar que las etiquetas de “pendiente” para el usuario alineen con **Por cobrar / Por pagar** del plan maestro cuando se migre Arbitraje; hoy el formulario no usa `pendingTypeLabels` en el mismo sentido que Compra/Venta (revisión cosmética/UX, no bloque de backend en esta auditoría).

---

## E2E UI (plan maestro § 1.2) — 2026-04-29

**Stack:** Postgres 16 (Docker local), API `go run ./cmd/api` con `DATABASE_URL`, frontend `npm run dev` en `http://127.0.0.1:5173/`. Usuario **FG** (`upsert-login-user`). Cliente semilla **#1 — CC E2E, Cliente** (`cc_enabled=true`), cuenta **Caja E2E**, divisas ARS/USD.

**Nota de rutas:** en esta app, **Posición de caja** (saldos `movement_lines`) está en **`/posicion-caja`**. La ruta **`/posiciones`** corresponde a **Estado de CC** (listado por cliente); se usó también para cruzar saldo CC con DB.

| Paso | Evidencia |
|------|-----------|
| ANTES — `/posicion-caja` | Sin movimientos / saldos en cero según pantalla inicial. |
| ANTES — `/posicion-integral` | Caja física y totales en cero (sin cotización USD cargada). |
| Flujo | Login → Nueva operación → Arbitraje → cliente #1 [CC] → costo/cobrado/profit **Caja E2E**, **ARS**, **Efectivo**, montos **100,00 / 105,00 / 5,00** (profit automático misma divisa) → **Guardar** → redirección a detalle **Operación #1**. |
| DB post-confirmar | `movement_lines`: OUT 100 ARS CASH; IN 105 ARS CASH; IN 5 ARS CASH. `cc_balances` cliente: **110 ARS** (105 cobrado + 5 profit; sin CC en costo, coherente con H-018). |
| DESPUÉS — `/posicion-caja` | **Caja E2E / ARS / Efectivo = 10,00** (= 105 + 5 − 100); coincide con suma de líneas CASH. |
| DESPUÉS — `/posicion-integral` | Tras cotización manual **1200** ARS/USD: bloques coherentes con caja neta y **CC neta** acorde al saldo comercial (≈ 110 ARS en USD). |
| DESPUÉS — `/posiciones` (Estado CC) | Cliente **CC E2E, Cliente #1** muestra **ARS 110,00** (verde), alineado con `cc_balances`. |

**Conclusión E2E:** para el caso **ARB-A1** (CC, patas no pendientes, profit > 0), la **UI refleja la DB** en posición de caja, posición integral (con tipo de cambio) y estado CC. Los hallazgos de código **H-017..H-024** siguen vigentes para otros casos (pendientes, costo en CC, asimetría `cc_apply_on_resolve`); **no** se ejecutó aún E2E completo de ARB-A2..A6.

---

## Smokes propuestos (para ejecutar cuando Postgres esté arriba)

Criterio: cada fila cumplimenta **A** y **B** del plan maestro (§ 1.1).

| ID | Cliente | Escenario | Datos (DB/API) | E2E UI (§ 1.2 plan maestro) |
|----|-----------|-----------|----------------|-----------------------------|
| ARB-A1 | CC | Costo y cobrado **no** pendientes; profit 0 o distinto de 0 | Filas en `movement_lines`, `cc_entries` (cobrado + profit), `profit_entries`; **sin** CC en costo | Mismo caso: capturar **ANTES/DESPUÉS** en `/posiciones` y `/posicion-integral`; confirmar que lo visible = lo esperado en DB |
| ARB-A2 | CC | Cobrado **pendiente** CASH | `pending_item` cobrado; sin CC cobrado al confirmar; luego resolve | UI: pendiente visible en `/pendientes` si aplica; tras resolve, CC/caja en posiciones |
| ARB-A3 | CC | Costo **pendiente** CASH | `pending_item` costo; `cc_apply_on_resolve` false | UI: bucket capital / pendientes coherente con tipo PAGO |
| ARB-A4 | Sin CC | Una pata pendiente | Solo `pending_items`, sin `cc_entries` | UI: `/pendientes` y capital sin filas CC nuevas |
| ARB-A5 | CC | Profit negativo (pérdida) | Línea OUT profit + `ccSideOut` en CC | UI: saldo cliente y notas en detalle CC si la pantalla lo muestra |
| ARB-A6 | — | Cierre transversal | Coherencia fórmula capital + CC neta | **Obligatorio:** mismo instante en UI que en SQL para el mismo `movement_id` |

---

## Próximos pasos sugeridos

1. **Decisión de producto:** ¿Arbitraje adopta la tabla maestra § 2.1 o queda **documentado como excepción** en `AUDITORIA_PLAN_MAESTRO.md` con justificación?
2. Ejecutar **ARB-A1..A6** con cliente testigo y capturas SQL.
3. Si hay fix acordado: nuevo sprint con prompt cerrado (regla de oro: alcance estricto).

---

## Actualización — Piloto dos clientes + tabla maestra (implementado 2026-04-26)

**Referencia:** `docs/PILOTO_ARBITRAJE_DOS_CLIENTES.md` reflejado en backend y frontend.

### Backend

- Migración `000024_arbitraje_two_clients`: columnas `arbitraje_cost_client_id` y `arbitraje_cobrado_client_id`; la cabecera `movements.client_id` se sincroniza con el **cliente cobrado** al persistir PATCH.
- `PatchMovementHeaderInput` incluye `arbitraje_cost_client_id` / `arbitraje_cobrado_client_id`, validación de clientes activos y mismas reglas de limpieza de borrador que tipo/cliente cuando cambian las patas.
- `arbitraje_service.Execute` deja de usar un solo `m.client_id` para todo: lee ambos UUID y `cc_enabled` por cliente; **costo OUT** sigue `decideCompraLineEffect` y el mismo sentido CC que Compra OUT pendiente; **cobrado IN** sigue `decideVentaLineEffect`; `InsertPendingItem` usa **`cc_apply_on_resolve = true`** en costo y cobrado; **cobrado spot con CC** mantiene `ccSideIn` y nota *Arbitraje — cobrado* (§ spot del piloto); el profit con CC sigue asociado al **cliente cobrado** (comportamiento temporal del piloto).
- El detalle GET del movimiento devuelve ambos IDs.
- Confirmación sin los dos clientes en cabecera: `ARBITRAJE_CLIENTS_REQUIRED`.

### Frontend

- `NuevaOperacionPage`: tipo ARBITRAJE sin combo global de cliente; estado y `sessionStorage` para los dos IDs; PATCH envía `client_id` = cobrado y los UUID de arbitraje; se fuerza `fetchClients` cuando el tipo es ARBITRAJE.
- `ArbitrajeForm`: dos `ClientSearchCombo` (costo antes de SALE, cobrado antes de ENTRA), validación en submit, borrador persiste los IDs; etiqueta IN pendiente alineada a **Pendiente de cobro** (misma lectura que Venta IN).

### Hallazgos históricos vs esta entrega

| ID | Estado |
|----|--------|
| H-017 | **Mitigado** — con CC y pata marcada pendiente CASH se aplica la tabla maestra (CC al confirmar, sin `pending_items` en ese caso). |
| H-018 | **Parcial** — costo **pendiente** con CC genera CC como Compra OUT; costo **spot** sin CC adicional queda como en el piloto § spot. |
| H-019 | **Mitigado** — simetría `cc_apply_on_resolve` en costo y cobrado. |

**Chequeos de build:** `go test ./...` y `npm run build` correctos en el repo. Los smokes ARB-A2..A6 contra Postgres y UI siguen recomendados tras aplicar la migración en el entorno objetivo.

---

## Auditoría plan maestro (`AUDITORIA_PLAN_MAESTRO.md`) — ejecución 2026-04-30

**Metodología:** dimensión **A** (regla / invariantes API+DB) y **B** solo en **capas persistidas** (`movement_lines`, `pending_items`, `cc_entries`, `profit_entries`), según § 3 del plan. La dimensión **B en UI** (§ 1.2 — mismos números en `/posicion-caja`, `/posiciones`, `/posicion-integral`, `/pendientes`) **no se repitió fila por fila en esta corrida**: queda como verificación manual recomendada sobre los **IDs listados abajo**.

**Herramienta reproducible:** `scripts/audit-arbitraje-plan-mayor.sh` (requiere API `:8080`, Postgres `fina/fina`, usuario `e2e_browser` o adaptar login).

### Matriz ARB-A1..A6 — resultado (DB)

| Caso | Escenario | Dimensión A | Dimensión B (DB) | `movement_id` (ejemplo corrida local) |
|------|-----------|-------------|------------------|---------------------------------------|
| **ARB-A1** | CC; costo/cobrado spot; profit + misma divisa | OK — CONFIRMADA; cabecera alinea `client_id` = cobrado + UUID costo/cobrado | OK — 3 líneas caja (OUT costo, IN cobro, IN profit); **sin** `pending_items`; `cc_entries` *Arbitraje — cobrado* + *ganancia*; **sin** CC en costo spot | `b8b78476-5c7e-4d0e-80a4-b76273fed1b7` |
| **ARB-A2** | CC; cobrado IN pendiente CASH | OK — tabla maestra § 2.1 | OK — línea IN cobrado `is_pending=t`; **0** `pending_items`; CC nota *Venta — pago pendiente del cliente* (−60 ARS); profit CC aparte | `d145bb10-8a6a-4227-b4c7-7ae06575791b` |
| **ARB-A3** | CC; costo OUT pendiente CASH | OK | OK — OUT costo `is_pending=t`; **0** `pending_items`; CC *Compra — pago pendiente al cliente* (+40 ARS); cobrado spot *Arbitraje — cobrado* | `4062bf90-0fc0-408e-9886-a3710d1aed58` |
| **ARB-A4** | Sin CC; solo costo pendiente | OK | OK — 1 `pending_items` ABIERTO tipo `PENDIENTE_DE_PAGO`, `cc_apply_on_resolve=t`; **sin** `cc_entries` | `a7a9840a-b8a7-4d6f-a735-c7ae15b07f6c` |
| **ARB-A5** | CC; pérdida (profit negativo) | OK | OK — línea OUT profit; `profit_entries` negativo; CC *Arbitraje — pérdida* (−20 ARS) | `5afa671c-00be-4b42-8312-1ccdf2731089` |
| **ARB-A6** | Cierre transversal caja (suma líneas CASH) | OK — sobre ARB-A1 | OK — Σ(IN−OUT) en líneas **CASH** = **10** (= 105 + 5 − 100), coherente con pata única de cuenta | (usa mismo movimiento que A1 de la corrida) |

### Notas de alineación con el documento histórico

- La tabla **“Arbitraje no implementa…”** más arriba en este archivo describe el **código previo al piloto**; frente al **`AUDITORIA_PLAN_MAESTRO.md` § 2.1**, la versión actual de `Execute()` **sí** replica la matriz por pata vía `decideCompraLineEffect` / `decideVentaLineEffect`.
- La fila antigua de smokes ARB-A2 que pedía **`pending_items`** en cobrado pendiente con CC está **desactualizada**: el comportamiento canónico es **CC sin `pending_items`** en ese caso (como en esta corrida).

### Cierre formal § 1.2 (UI) — ejecutado (2026-04-26)

Sesión única tipo operador (navegador local contra `http://127.0.0.1:5173`), usuario con rol **SUPERADMIN**. Caso ejecutado: **ARB-A1** (cliente CC, costo/cobrado **spot** efectivo ARS, ganancia automática misma divisa **sin** pendientes), piloto **dos clientes** con **mismo** cliente en costo y cobrado (**#1 — CC E2E, Cliente**).

| Paso | Evidencia |
|------|-----------|
| Flujo UI | **Nueva operación** → tipo **Arbitraje** → borrador **#5**, fecha **2026-04-30** → clientes costo/cobrado seleccionados vía combo (texto de filtro **`E2E`** + teclado; evitar solo **`#1`** como filtro: no matchea código numérico). Cuenta/divisa/formato: **Caja E2E / ARS / Efectivo** en costo, cobrado y ganancia. Montos **200,00 / 215,00 / 15,00** (ganancia automática). **Guardar** → confirmación **CONFIRMADA** → detalle **`/movimientos/d3c6bef5-f3de-49d3-876f-7adce7eef95a`** (titular **Operación # 5**). |
| ANTES — `/posiciones` | Cliente **CC E2E, Cliente #1**, saldo **ARS 580,00** (captura previa misma corrida). |
| DESPUÉS — `/posiciones` | Mismo cliente **ARS 810,00**. **Δ +230 ARS**, coherente con impacto CC en cobrado + ganancia sin CC en costo spot (**215 + 15**) según comportamiento actual documentado post-piloto. |
| ANTES — `/posicion-caja` | **Caja E2E / ARS / Efectivo = 76,00** (captura previa misma corrida). |
| DESPUÉS — `/posicion-caja` | **106,00**. **Δ +30 ARS** (= −200 + 215 + 15). |
| ANTES — `/posicion-integral` | Referencia bitácora sesión anterior misma corrida: corte **29/04/2026**, cotización manual **1200** ARS/USD (numeralia ya registrada en la narrativa de auditoría). |
| DESPUÉS — `/posicion-integral` | Corte **30/04/2026** (fecha de la operación), cotización **1200**. Tras **Actualizar**: **Capital propio (USD) 0,69** (fórmula visible: bruto **0,04** + CC neta **0,68** + por cobrar **0,00** − por pagar **0,03**); bloque **Comisiones / Profit** total equiv. USD **0,02** (~ **15 ARS** al tipo manual); acordeón efectivo libro **ARS 50,00**. |
| `/pendientes` | Lista sin filas en el snapshot posterior al caso (operación **sin** pendientes CASH marcados): revisión **no aplicable** más allá de constatar pantalla vacía para este smoke. |

**Conclusión § 1.2:** para el caso **ARB-A1** en UI, los deltas en **Estado CC** y **Posición de caja** cuadran con la interpretación económica del movimiento (−costo / +cobro / +ganancia en caja; CC + cobro + ganancia sin reverso CC en costo spot). **Posición integral** al **30/04** muestra contribución de profit en USD (~**0,02**). Quedan como trabajo aparte los **E2E UI explícitos ARB-A2..A6** (pendientes CC, sin CC, pérdida, etc.) si se desea evidencia pantalla por pantalla para cada fila de la matriz.

---

*Auditoría: lectura de código + E2E UI documentado arriba; sección piloto con verificación de build 2026-04-26; auditoría plan maestro datos 2026-04-30; **§ 1.2 cierre formal UI ARB-A1** 2026-04-26.*
