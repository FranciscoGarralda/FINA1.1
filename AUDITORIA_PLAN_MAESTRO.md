# Plan maestro de auditoría — Lógica de negocio, CC, caja y pendientes

**Última actualización del documento:** 2026-04-29  
**Tipo:** plan de trabajo y checklist — **no modifica código**; sirve para encadenar auditorías con el mismo rigor que Compra y Venta.  
**Referencia de oro (la más completa trabajada):** `HALLAZGOS_AUDITORIA_VENTA.md` (metodología, tabla maestra, smokes, IDs, OKs).

---

## 1. Propósito

Unificar en un solo lugar:

1. **Tu lógica de negocio** (cómo debe comportarse el sistema en cada tipo de operación).
2. **Dónde debe impactar** cada decisión (caja, CC, pendientes, reportes, posición integral, inicio).
3. **Qué ya fue auditado y cerrado** (Compra, Venta, signos H-013..H-016).
4. **Qué queda pendiente** y en qué orden conviene encararlo.
5. **Cómo ejecutar** cada auditoría futura (misma plantilla que Venta: lectura de código + **datos en DB** + **recorrido como usuario en la UI** + registro de hallazgos con ID).

### 1.1 Qué significa “auditar” en este plan (doble verificación + E2E)

Cada auditoría de módulo debe cerrar **las preguntas A y B** y además la **prueba de punta a punta en pantalla (§ 1.2)**. **Solo** lectura de código o **solo** queries SQL **no alcanza** para dar por cerrada una auditoría de impacto: el operador vive en la **aplicación**.

| Dimensión | Pregunta | Evidencia típica |
|-----------|----------|------------------|
| **A — Comportamiento correcto** | ¿La operación hace lo que la regla de negocio exige? (cuadre, validaciones, rechazos, estados BORRADOR/CONFIRMADA, signos CC, ausencia de doble impacto) | API devuelve `ok` o error esperado; invariantes en DB |
| **B — Impacto en el lugar correcto** | ¿Los importes aparecen **solo** en los libros **y en las pantallas** que corresponden? | `movement_lines` / `cc_entries` / `pending_items` como en § 3 **y** lo que ve el usuario en **§ 1.2** (mismos números y sentido: cobrar / pagar / CC / capital) |

**Regla práctica:** después de cada caso, anotar **“¿impactó donde no debía?”** (libros **y** UI) y **“¿la UI mintió respecto de la DB?”** (ej. capital que no refleja pendientes; CC que no coincide con `/posiciones`).

### 1.2 Prueba de punta a punta — obligatoria (usuario real / simulado)

Objetivo: **misma sesión** que usaría un operador: **clics**, formularios, confirmación y **comprobación visual** (o captura) de que el impacto es el esperado.

**Mínimo por módulo que toca cliente / CC / pendientes / capital:**

| Paso | Acción | Qué validar (dimensión B en UI) |
|:--:|--------|----------------------------------|
| 1 | Login con rol que pueda ejecutar la operación | Acceso a Nueva operación / movimientos |
| 2 | Anotar **ANTES**: captura o valores en **`/posiciones`** (cliente CC) y **`/posicion-integral`** (capital, CC neta, por cobrar / por pagar si aplica) | Línea base |
| 3 | **Flujo completo en UI:** alta de movimiento → tipo de operación → completar patas → **confirmar** (no solo guardar borrador si el test es “operación viva”) | Sin errores de validación; estado CONFIRMADA |
| 4 | Anotar **DESPUÉS** en las **mismas** pantallas del paso 2 | Delta coherente con la regla de negocio y con lo visto en DB |
| 5 | Si hay pendientes: **`/pendientes`** (lista, resolver/cancelar/compensar según el caso de prueba) | Lista y buckets alineados con § 2.3 |
| 6 | Opcional pero recomendable: **`/movimientos`** (detalle del movimiento), **`/inicio`** (solo si el caso debería mover utilidad/profit del día) | Coherencia con § 7 |

**Cierre:** en el doc de hallazgos del módulo, una subsección **“E2E UI”** con fecha, usuario/rol, rutas visitadas y **ANTES / DESPUÉS** (texto o captura). Si no se pudo ejecutar (ej. sin DB), declarar **“E2E pendiente — motivo”**; el módulo **no** se considera auditado al 100 %.

---

## 2. Reglas de negocio vigentes (canónicas — post sprints Compra / Venta / signo CC)

Estas reglas **sustituyen o matizan** el texto antiguo de “lógica deseada” en `HALLAZGOS_AUDITORIA_SISTEMA.md` § inicial donde contradiga la **tabla maestra** acordada. Lo cerrado en código y documentación de sprint es:

### 2.1 Tabla maestra — presencia de `pending_items` vs `cc_entries` (Compra y Venta)

| `cc_enabled` | Pata en pendiente (CASH, `pending_cash=true`) | `pending_items` | `cc_entry` en esa pata |
|:--:|:--:|:--:|:--:|
| **Sí** | **Sí** | **NO** crear | **SÍ** (con `ccSide` semántico — ver § 2.2) |
| **Sí** | **No** | NO | **NO** (solo caja vía `movement_lines`; no CC fantasma) |
| **No** | **Sí** | **Sí** (`InsertPendingItem`) | NO |
| **No** | **No** | NO | NO |

**Implementación:** helpers `decideCompraLineEffect` / `decideVentaLineEffect` en `compra_service.go` / `venta_service.go`.

### 2.2 Tabla maestra — **signos** CC para patas pendientes (H-013..H-016)

Convención sistema (`cc_service.go` / `cc_repo.go`): **`+`** = saldo a favor del cliente (la casa le debe); **`−`** = deuda del cliente con la casa.

| Operación | Pata pendiente | Quién debe a quién | `applyCCImpactTx` usa | Efecto en balance cliente |
|-----------|----------------|---------------------|-------------------------|---------------------------|
| **Compra** | IN | Cliente debe entregar la divisa → debe a la casa | `ccSideOut` | `−` |
| **Compra** | OUT | Casa debe pagar cotización → casa debe al cliente | `ccSideIn` | `+` |
| **Venta** | OUT | Casa debe entregar divisa → casa debe al cliente | `ccSideIn` | `+` |
| **Venta** | IN | Cliente debe pagar → debe a la casa | `ccSideOut` | `−` |

**Tests de defensa:** `backend/internal/services/cc_sign_invariant_test.go` (convención helper + tabla semántica + lectura estructural de `compra_service.go` / `venta_service.go`).

### 2.3 Pendientes sin CC — etiquetas y capital (`PosicionIntegralPage`)

Tras los fixes de Compra (H-004, H-005, H-006) y el frontend:

- Bucket **“Por cobrar”** (suma al capital propio en la fórmula acordada): pendientes que son **derecho a cobrar** al cliente.
- Bucket **“Por pagar”** (resta): obligaciones de la casa de pagar / entregar.
- Helpers: `isPendingPorCobrar` / `isPendingPorPagar`, etiquetas en `frontend/src/utils/pendingTypeLabels.ts`.

**Fórmula acordada (referencia):**  
`Capital propio ≈ Bruto caja + CC neta + Por cobrar pendientes − Por pagar pendientes` (ver implementación actual en `PosicionIntegralPage.tsx` y docs en sistema).

### 2.4 Caso especial — DIGITAL + “pendiente” (H-012)

`pending_cash && format == "CASH"` en backend: si marcan pendiente con **DIGITAL**, el flag **no aplica** (instantáneo). CERRADO como comportamiento esperado; mejora UX opcional (deshabilitar checkbox o validar en API).

### 2.5 Resolver pendientes — reglas globales

- **`REAL_EXECUTION`:** ejecuta caja y puede aplicar **CC diferida** si `cc_apply_on_resolve` y cliente CC (`pending_service.go`).
- **`COMPENSATED`:** cierra sin ejecución de caja y **sin** nuevo impacto CC por regla de negocio (#21 en reglas de oro) — documentado en `pending_service.go`.

---

## 3. Dónde impacta cada capa (mapa mental para auditorías)

| Capa | Qué es | Auditás que… |
|------|--------|----------------|
| **`movement_lines`** | Caja real (IN/OUT, cuenta, formato, `is_pending`) | Cuadre, líneas duplicadas, reversión en cancel/modify |
| **`cc_entries` / `cc_balances`** | Deuda comercial del cliente vs casa | Signo, nota, `sum(entries)` vs balance, sin doble impacto con caja liquidada |
| **`pending_items`** | Obligaciones abiertas (solo clientes **sin** CC en patas pendientes; CC usa CC) | No duplicar con CC; tipos coherentes con UI; `cc_apply_on_resolve` cuando aplique |
| **`profit_entries`** | Comisiones / resultado explícito | Coherencia con CC en ese movimiento si el negocio lo exige |
| **`fx_inventory_ledger` / inventario** | P&L compra-venta | Alineación con movimientos CONFIRMADOS |
| **Reportes / Inicio** | `reportes_service.go` — utilidad, profit, gastos, resultado | Fuentes distintas a CC (ver § 7) |
| **Posición integral** | Capital, buckets pendientes, CC neta | Fórmula + etiquetas + filas por bucket |

---

## 4. Inventario de hallazgos ya trabajados (no olvidar nada)

### 4.1 Compra + sistema (`HALLAZGOS_AUDITORIA_SISTEMA.md`)

| ID | Tema | Estado | Notas |
|----|------|--------|--------|
| H-001 | Asimetría CC Compra (solo IN a CC) | ✅ Cerrado en sprint Fix Compra | Tabla maestra + helpers |
| H-002 | Capital inflado por CC fantasma (derivado H-001) | ✅ Cerrado | |
| H-003 | Saltos numeración operaciones | 🟢 Abierto / diseño | Fuera de alcance técnico típico |
| H-004 | IN pendiente Compra y bucket “Retiro” | ✅ Cerrado | Etiquetas + Por cobrar |
| H-005 | OUT pendiente Compra huérfano en capital | ✅ Cerrado | Por pagar |
| H-006 | Bucket “Retiros” mezclaba conceptos | ✅ Cerrado | Por cobrar / Por pagar |
| Smokes | A1–A7 (CC), B1–B7 (sin CC) | ✅ Documentados en sistema | Matriz formato |

### 4.2 Venta (`HALLAZGOS_AUDITORIA_VENTA.md`)

| ID | Estado |
|----|--------|
| H-007 IN sin CC | ✅ |
| H-008 pending_items + CC | ✅ |
| H-009 condición OUT invertida | ✅ |
| H-010 comentarios / etiquetas | ✅ |
| H-011 cc_balances post DELETE manual | Abierto / dev only |
| H-012 DIGITAL + pending | CERRADO esperado |
| H-013, H-014 signo CC Venta | ✅ |
| OK-1..OK-4 | Verificado |
| Smokes V1–V11 | En doc Venta |

### 4.3 Signo CC Compra+Venta (sistema + tests)

| ID | Archivo | Estado |
|----|---------|--------|
| H-015 Compra IN pendiente | `compra_service.go` | ✅ |
| H-016 Compra OUT pendiente | `compra_service.go` | ✅ |
| H-013, H-014 (ya arriba) | `venta_service.go` | ✅ |
| `cc_sign_invariant_test.go` | — | Defensa en CI |

### 4.4 Arbitraje, Transferencia, Pending (`HALLAZGOS_AUDITORIA_ARBITRAJE_TRANSFERENCIA.md`)

| ID | Estado |
|----|--------|
| H-017 pending_items + CC | Lectura — pendiente decisión/fix sprint |
| H-018 CC sin pata costo | Lectura |
| H-019 cc_apply_on_resolve asimétrico | Lectura |
| H-020 Transferencia línea vs tabla maestra / resolve | A falsar con smokes |
| H-021 Fee + OWED_PENDING | Lectura |
| H-022 Resolve genérico por `MovementLineSide` | Lectura |

**Profundización solo Arbitraje (2026-04-29):** `HALLAZGOS_AUDITORIA_ARBITRAJE.md` — tabla maestra vs código, H-023/H-024, smokes ARB-A1..A6 propuestos. **Actualización 2026-04-30:** misma guía documenta **auditoría plan maestro en DB** (ARB-A1..A6 ejecutados vía `scripts/audit-arbitraje-plan-mayor.sh`). **Actualización 2026-04-26:** **§ 1.2 E2E UI** cerrado formalmente para **ARB-A1** (ANTES/DESPUÉS en `/posiciones`, `/posicion-caja`, `/posicion-integral`, chequeo `/pendientes` vacío en ese caso); evidencia en `HALLAZGOS_AUDITORIA_ARBITRAJE.md` § “Cierre formal § 1.2”. Pantalla por pantalla para **ARB-A2..A6** sigue opcional recomendada.

### 4.5 Smokes runtime signo CC (post H-013)

Referencias en docs: **S1–S4** (Venta/Compra CC, Postgres local), consistencia `balance == sum(cc_entries)`.

---

## 5. Qué falta auditar (orden recomendado)

Cada fila debe terminar en un **documento tipo Venta**: resumen ejecutivo tabla, tabla maestra del módulo (o excepción justificada), hallazgos con ID, smokes numerados, OKs, evidencia SQL/API.

| Prioridad | Módulo | Archivo(s) principal(es) | Objetivo de la auditoría |
|:--:|--------|---------------------------|---------------------------|
| **1** | **Arbitraje** | `arbitraje_service.go` | `HALLAZGOS_AUDITORIA_ARBITRAJE.md` + **§ 1.2 E2E**. Estado **2026-04-30:** dimensión **A** + **B en DB** para ARB-A1..A6 **cerradas** (script reproducible). Estado **2026-04-26:** **§ 1.2 UI** **cerrado** para **ARB-A1** (evidencia ANTES/DESPUÉS en hallazgos); **ARB-A2..A6** en UI opcional si se quiere captura por fila. |
| **2** | **Transferencia** | `transferencia_service.go` | Tres modelos: legacy, dual-leg, signed. Cerrar o refutar H-020 con T1–T4. Política pending+CC. |
| **3** | **PendingService** | `pending_service.go` | Matriz REAL vs COMPENSATED; CC diferida y coherencia con § 2.2 cuando el pendiente viene de OTRO módulo. |
| **4** | **Pago CC cruzado** | `pago_cc_cruzado_service.go` | Sides dinámicos, límites, coherencia con CC y reglas de cliente. |
| **5** | **Gasto** | `gasto_service.go` | CC si hay cliente; líneas OUT |
| **6** | **Traspaso deuda CC** | `traspaso_deuda_cc_service.go` | Revalidar simetría (lectura previa OK). |
| **7** | **Ingreso / Retiro capital** | `ingreso_capital_service.go`, `retiro_capital_service.go` | Revalidar con smoke (lectura previa OK). |
| **8** | **Transferencia entre cuentas** | `transferencia_entre_cuentas_service.go` | Cliente/CC/pendientes si aplica |
| **9** | **Apertura pendientes** | `opening_pending_service.go` | Sin CC; buckets capital |
| **10** | **Saldo inicial caja** | `cash_opening_balance_service.go` | Tipicamente sin CC cliente |
| **11** | **Operación / cancel / modify** | `operation_service.go` + handlers | Reversión CC + pendientes (parcialmente cubierto en Venta OK-2). |
| **12** | **Inventario FX** | `fx_inventory_service.go` | Coherencia con Compra/Venta y reportes |
| **13** | **Reportes e Inicio** | `reportes_service.go` | Origen de cada métrica vs CC (`DailySummary` ≠ saldos CC); evitar comparar peras con manzanas |
| **14** | **Posición caja / arqueos** | `cash_position_service.go`, `cash_arqueo_service.go` | Consistencia con líneas |
| **15** | **Frontend operaciones** | `frontend/src/components/operations/`, `pendingTypeLabels.ts` | Payloads, etiquetas, checkboxes pendiente |
| **16** | **Clientes (`cc_enabled`)** | `client_service.go` + UI cliente | Ver § 11.1 |
| **17** | **Listados de movimientos** | `movement_service.go` + API listado/detalle | Ver § 11.6 |
| **18** | **Export CC** | Handler `cc-entries/export.csv` vs list | Consistencia de criterios con `GET /api/cc-entries` |

Las filas **16–18** amplían la tabla principal; el detalle de qué revisar en cada una está en **§ 11**.

---

## 6. Metodología obligatoria por módulo (copia de Venta + E2E)

1. **Lectura estática** del `Execute()` (o equivalente): flujo `cc_enabled`, pendientes, `applyCCImpactTx`, `InsertPendingItem`, flags `cc_apply_on_resolve`.
2. **Contrastar con § 2** de este documento. Si el módulo no es Compra/Venta, **explicitar en el doc de hallazgos** si adopta la misma tabla o una variante **justificada por negocio**.
3. **Libros:** `movement_lines`, `cc_entries`, `pending_items`, `profit_entries` si aplica, `audit_logs`, `cc_balances` vs `sum(cc_entries)`.
4. **Smokes de datos:** casos numerados (ej. ARB-A1, TRF-T1), cliente CC y sin CC, CASH/DIGITAL, **anotar esperado vs observado** en SQL/API.
5. **E2E en UI (obligatorio — § 1.2):** mismo caso que en el paso 4, ejecutado **desde la aplicación** (clics), con **ANTES/DESPUÉS** en **`/posiciones`** y **`/posicion-integral`** como mínimo; ampliar con `/pendientes` / `/movimientos` / `/inicio` según el módulo. Sin este paso, la auditoría **no está completa**.
6. **Cierre A + B (§ 1.1):** documentar regla de negocio + libros + **coincidencia UI ↔ DB** (o discrepancia explícita como hallazgo).
7. **Validaciones OK:** cuadre, cancel, modify, recreate — como OK-1..OK-4 en Venta (idealmente también **un** recorrido UI de cancelación si el módulo lo permite).
8. **Documento de salida:** mismo esquema que `HALLAZGOS_AUDITORIA_VENTA.md` + subsección **E2E UI** + enlace desde `HALLAZGOS_AUDITORIA_SISTEMA.md` cuando se cierre un sprint.

---

## 7. Inicio vs CC (evitar falsos problemas)

- **Inicio** (`GET /api/dashboard/daily-summary`): utilidad desde **inventario FX** (`fx_inventory_ledger`), profit desde **`profit_entries`**, gastos desde movimientos **GASTO** — ver definiciones en `reportes_service.go` → `DailySummary`.
- **Reportes por rango** (`GET /api/reportes`): misma base lógica (`Generate`); validar coherencia con Inicio para un mismo día (ver § 11.2).
- **No** es la misma fuente que **Estado CC** (`cc_entries`).
- Una operación puede ser “correcta” en CC y no mover la **utilidad del día** en Inicio si el P&L se registra por otra vía (inventario vs crédito comercial).

Auditorías futuras que comparen pantallas deben citar **dos fuentes** explícitamente.

---

## 8. Plantilla rápida de smoke (copiar al doc de cada módulo)

Incluye **siempre** bloque **datos** + bloque **E2E UI** (mismo ID de caso).

```
ID: ___-__
Cliente: CC sí/no — client_id: ___
--- Datos (API/SQL) ---
Payload / API: ...
Dimensión A (regla de negocio): cumple sí/no — nota:
Esperado — movement_lines: ...
Esperado — cc_entries (nota + signo): ...
Esperado — pending_items: ...
Esperado — delta cc_balances por moneda: ...
Observado (DB/API): ...
--- E2E UI (obligatorio) ---
Rol de sesión: ...
ANTES — /posiciones (cliente): ...
ANTES — /posicion-integral (totales relevantes): ...
Acciones UI: (ruta → clics resumidos, ej. Nueva operación → Arbitraje → … → Confirmar)
DESPUÉS — /posiciones: ...
DESPUÉS — /posicion-integral: ...
¿UI coincide con DB? sí/no — nota:
(Otras rutas: /pendientes, /movimientos, /inicio — si aplica)
Hallazgo nuevo: H-___ o OK
```

---

## 9. Documentos del repositorio (índice)

| Archivo | Rol |
|---------|-----|
| `AUDITORIA_PLAN_MAESTRO.md` | **Este plan** — hoja de ruta y lógica canónica |
| `HALLAZGOS_AUDITORIA_SISTEMA.md` | Histórico global, backlog, **H-001..H-006 Compra**, A1–A7 / B1–B7, tablas de cierre (no hay `HALLAZGOS_AUDITORIA_COMPRA.md` separado) |
| `HALLAZGOS_AUDITORIA_VENTA.md` | Plantilla completa del sprint Venta |
| `HALLAZGOS_AUDITORIA_ARBITRAJE_TRANSFERENCIA.md` | Primera lectura Arbitraje + Transferencia + Pending |
| `HALLAZGOS_AUDITORIA_ARBITRAJE.md` | Auditoría dedicada **Arbitraje** (plan maestro, A+B, smokes propuestos) |
| Tests | `cc_sign_invariant_test.go`, `*_cc_test.go` |

---

## 10. Confirmación de alcance

- **Este archivo:** solo documentación de planificación y trazabilidad.
- **No incluye:** commits, cambios de código, refactors ni correcciones.

---

## 11. Alcances complementarios (detalle; prioridad según negocio)

Estos ítems **no sustituyen** la tabla § 5, la **completan**: son frentes donde también se verifica **A + B** del § 1.1 (comportamiento correcto + impacto en el libro o pantalla que corresponde).

### 11.1 Clientes — flag `cc_enabled`

**Qué auditar:** al **crear/editar** cliente, activar o desactivar **cuenta corriente** (`cc_enabled`). Comprobar que el sistema no rompe invariantes: movimientos históricos siguen siendo legibles; nuevas operaciones respetan el flag; no se generan `cc_entries` para cliente sin CC ni se omiten para cliente con CC cuando la tabla maestra exige CC.

**Impacto esperado:** solo cambia el **comportamiento de futuras** operaciones según el flag; los datos históricos de CC deben seguir cuadrando (salvo regla explícita de migración que hoy no existe).

**Prioridad:** media/baja si en operación real casi nunca se togglea CC; sube si se edita seguido.

### 11.2 Reportes — dos entradas API

**Qué auditar:** no limitarse a `GET /api/dashboard/daily-summary` (Inicio). Incluir **`GET /api/reportes`** con rango `from`/`to`: misma lógica interna (`ReportesService.Generate`) pero conviene **documentar smokes** que usen **ambos** endpoints y comprobar que las métricas (utilidad, profit, gastos, resultado) coinciden con la misma definición del backend para un mismo día.

**Impacto esperado:** Inicio y reportes por rango **no** deben contradecirse para el mismo universo de movimientos CONFIRMADOS; siguen siendo **independientes** del saldo CC (ver § 7).

### 11.3 Pantalla `/pendientes` — UI + API

**Qué auditar:** `frontend/src/pages/PendientesPage.tsx` (y componentes asociados) junto con:

- `PATCH /api/pendientes/{id}/resolver` (modos REAL_EXECUTION / COMPENSATED),
- `PATCH /api/pendientes/{id}/cancelar`,
- flujo **compensar** (visible según permisos y cliente CC, según reglas ya documentadas en sistema).

**Impacto esperado:** al resolver, las líneas de caja y el CC diferido (si aplica) reflejan **una sola vez** el dinero real; la lista de abiertos y los buckets en posición integral se actualizan de forma coherente.

### 11.4 Settings que afectan pendientes

**Qué auditar:** claves como `pending_allow_partial_resolution` (y cualquier otra en `settings` que el `PendingService` lea). Comprobar que con valor true/false el comportamiento es el documentado y que no deja pendientes en estado ambiguo.

**Impacto esperado:** solo el **alcance** de resolución parcial; no debe alterar signos CC ni tabla maestra de Compra/Venta.

### 11.5 Dónde viven los hallazgos de Compra

**Importante:** no existe un archivo `HALLAZGOS_AUDITORIA_COMPRA.md` separado. Los hallazgos **H-001..H-006** y la matriz de smokes **A1–A7 / B1–B7** están en **`HALLAZGOS_AUDITORIA_SISTEMA.md`** (y el cierre del sprint Compra en la misma nota). Al auditar otro módulo, **citar** ese documento para no duplicar historia.

### 11.6 Listados y detalle de movimientos (`movement_service`)

**Qué auditar:** lectura de `GET /api/movements`, `GET /api/movements/{id}`: totales y detalle mostrados al usuario **coinciden** con sumas en DB para ese movimiento (líneas, estado, cliente). Prioridad baja si solo es proyección; sube si la UI muestra totales que la operación usa para decisiones.

**Impacto esperado:** solo **visualización**; no nuevos asientos contables.

### 11.7 Export CSV de CC

**Qué auditar:** que el criterio de filas (`GET /api/cc-entries/export.csv`) sea **coherente** con el listado paginado de entradas CC (mismos filtros implícitos o documentar diferencias).

**Impacto esperado:** trazabilidad y auditoría externa; no debe mostrar un universo distinto al listado sin justificación.

---

*Al cerrar cada módulo, actualizar § 4 y § 5 y, si corresponde, añadir una fila al resumen ejecutivo de `HALLAZGOS_AUDITORIA_SISTEMA.md`. Los ítems complementarios § 11 se revisan cuando el negocio los use con frecuencia o antes de un release que toque clientes, pendientes o export.*
