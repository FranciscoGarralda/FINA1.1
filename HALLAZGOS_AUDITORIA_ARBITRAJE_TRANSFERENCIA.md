# Hallazgos de auditoría — Arbitraje, Transferencia y `PendingService`

> Auditoría de **solo lectura** (sin cambios de código) realizada sobre el backend, alineada con la convención de CC publicada en `HALLAZGOS_AUDITORIA_SISTEMA.md` (sprint H-013..H-016) y con `cc_impact.go` / `cc_service.go` (*positive = saldo a favor del cliente / debt reduction; negative = client owes more*).

**Alcance:** `arbitraje_service.go`, `transferencia_service.go` (modelo legacy + dual-leg + signed), `pending_service.go` (`Resolve` / `Cancel`).

**Método:** lectura de código, contraste con la tabla maestra de Compra/Venta, trazado de `pending_items` + `cc_apply_on_resolve`, sin ejecución de smokes (pendiente de validación con balance inicial fijado en una sesión dedicada).

---

## Resumen ejecutivo

| ID | Tema | Severidad | Estado |
|----|------|-----------|--------|
| H-017 | Cliente con CC y patas pendientes: aún se crean `pending_items` (Arbitraje y Transferencia), distinto a Compra/Venta | 🟠 Alto | Registrado |
| H-018 | Arbitraje: `applyCCImpactTx` nunca aplica a la pata **costo (OUT)**, solo a cobrado (no pend.) y a profit | 🟠 Alto | Registrado |
| H-019 | Arbitraje: `cc_apply_on_resolve` asimétrico (costo `false` vs cobrado `true`) + naming de `InsertPendingItem` | 🟡 Medio | Registrado |
| H-020 | Transferencia: OUT/IN **REAL** mapea `movement_line` IN/OUT = `ccSide` 1:1; posible conflicto con la tabla de **pendientes** al resolver (usa `MovementLineSide` = `ccSide` en el resolve) | 🔴 Crítico (a validar) | Registrado |
| H-021 | Transferencia legacy: riesgo documentado comisión cuando cobro es solo `OWED_PENDING` | 🟡 Medio | Registrado |
| H-022 | `PendingService.Resolve`: CC diferida toma el side desde `MovementLineSide` sin `decide*Operacion` (no distingue Venta/Compra/Transferencia) | 🟠 Alto | Registrado |

---

## H-017 — `pending_items` para clientes CC en Arbitraje y Transferencia

**Severidad:** 🟠 Alto (incoherencia de producto con Compra/Venta post–tabla maestra).

**Política acordada (sprint Compra/Venta):** si `cc_enabled` y la pata está en **pendiente**, no debe generarse `pending_item`; el efecto pasa a `cc_entries` vía `applyCCImpactTx` (ver `decideVentaLineEffect` / `decideCompraLineEffect`).

**Observado**

- `arbitraje_service.go`: con `costoPending` o `cobradoPending` se inserta `pending_item` (líneas 122-127, 137-142) **sin** condicionar a `!ccEnabled`.
- `transferencia_service.go` — dual-leg, signed, y modelo legacy (delivery / collections) — crea `pending_items` bajo `PENDIENTE` / `OWED_PENDING` con la misma lógica **para cualquier** cliente, sin bifurcar por `ccEnabled`.

**Riesgo:** doble pista (lista de pendientes + CC) o expectativas de UI/operación distintas según módulo.

**Archivos de referencia:** `arbitraje_service.go` 115-142, `transferencia_service.go` 405-456, 643-703, 841-855.

---

## H-018 — Arbitraje: ausencia de CC en la pata **costo (OUT)**

**Severidad:** 🟠 Alto (asimetría CC; relacionado con el debate histórico H-001 Compra: ¿una o dos patas a CC?).

**Observado:** solo se llama a `applyCCImpactTx` para:

1. `cobrado` si `ccEnabled && !cobradoPending` con `ccSideIn` (líneas 144-147).
2. `profit` positivo/negativo con `ccSideIn` / `ccSideOut` (líneas 165-183).

**No** hay bloque análogo para el **costo** (línea OUT), esté o no en pendiente.

**Pregunta de negocio (no cerrada en esta auditoría):** ¿el arbitraje vinculado a un `client_id` debe reflejar en CC solo el cobrado y el resultado, o también el desembolso de costo? Mientras no se defina, el comportamiento queda **asimétrico** frente a `transferencia_service`, que sí impacta IN y OUT.

**Archivo:** `arbitraje_service.go` 115-148.

---

## H-019 — Arbitraje: `cc_apply_on_resolve` y tipos de pendiente

**Severidad:** 🟡 Medio.

**Observado**

- Costo pendiente: `InsertPendingItem(..., false)` (línea 123) → al resolver, **no** entra al camino de CC diferida de `PendingService` (`cc_apply_on_resolve` falso).
- Cobrado pendiente: `InsertPendingItem(..., true)` (línea 138).

**Efecto:** asimetría en si el cierre vía `Resolve` podrá dejar asiento CC o no, según la pata. Requiere alinear con el modelo mental de “cobrado = IN pendiente = cliente debe entregarnos / nos debe” vs naming `PENDIENTE_DE_RETIRO` en el insert (coherente con otros módulos antiguos, pero fácil de confundir con la taxonomía nueva “Por cobrar / Por pagar”).

**Archivo:** `arbitraje_service.go` 122-142.

---

## H-020 — Transferencia: mapeo línea IN/OUT → `ccSide` vs tabla maestra en pendientes y resolve

**Severidad:** 🔴 Crítico **como hallazgo a falsar**; aquí se documenta el **tension** lógica, no un bug cerrado con smoke.

**Hechos**

1. **Confirmación, patas REAL (no pendientes):** p. ej. en `executeDualLegTransfer`, `OUT` not pending → `applyCCImpactTx` con `ccSideOut` y nota `"Transferencia — salida"`; `IN` not pending → `ccSideIn` y `"Transferencia — entrada"` (`transferencia_service.go` 666-674). Es el mapeo “contable” 1:1 con `cc_impact` (mismo `IN`/`OUT` que en `signedCCAmount`).

2. **Compra/Venta con pata pendiente (post H-013..H-016):** el `ccSide` **no** sigue el literal de la línea: p. ej. en Venta, línea `OUT` pendiente (casa aún no entregó) → `ccSideIn` (positivo) porque *la casa debe al cliente*.

3. **Pendiente resuelto con dinero real:** en `PendingService.Resolve`, si `cc_apply_on_resolve && CcEnabled`, se usa `ccSide := pending.MovementLineSide` (líneas 231-238). Es decir, se identifica el side de `applyCCImpactTx` con el **lado de la línea de movimiento**, no con una tabla por tipo de operación.

**Riesgo:** en un escenario *Transferencia* con salida `PENDIENTE` y luego `REAL_EXECUTION`, el asiento CC diferido podría aplicar `ccSideOut` por línea `OUT`, mientras la semántica económica de “aún no le pagamos al cliente / le debemos” en otros módulos se corrigió con `ccSideIn`. **Esto solo se cierra o refuta** con un smoke: balance cliente antes/después, misma moneda, caso OUT pendiente + resolve.

**Archivos:** `transferencia_service.go` 666-676, `venta_service.go` 125-131, `pending_service.go` 222-238.

---

## H-021 — Transferencia legacy: comisión y cobro `OWED_PENDING`

**Severidad:** 🟡 Medio (ya anotado en comentario interno).

**Observado:** en el bucle de collections, el CC de la comisión solo se aplica si el cobro es `REAL` (`c.C.Settlement == "REAL"`, línea 474-477). Existe comentario explícito de riesgo si el flujo de fee quedara solo en pending.

**Archivo:** `transferencia_service.go` 468-477.

---

## H-022 — `PendingService.Resolve`: genérico respecto al tipo de movimiento

**Severidad:** 🟠 Alto (interoperabilidad con H-020).

**Observado:** el resolve no conoce `m.type` (VENTA, COMPRA, TRANSFERENCIA, etc.); solo valida monto, modo, cuenta, y aplica `applyCCImpactTx` con el side de la línea. Eso es **coherente con una deuda** (“no segundo impacto” salvo regla explícita), pero **no** incorpora la tabla maestra de Compra/Venta. Cualquier operación que mezclara `cc_apply_on_resolve` con semántica de “obligación” desalineada con `IN`/`OUT` puro quedará expuesta.

**Archivo:** `pending_service.go` 117-275.

**Nota de política (regla de oro #21 / doc):** `COMPENSATED` no aplica CC diferido; eso está respetado (líneas 176-198).

---

## Próxima evidencia recomendada (sin ejecutada en este documento)

1. **Smokes T1–T4 (propuesta):** Transferencia dual-leg, cliente CC, una pata `PENDIENTE` y la otra `REAL`, con lectura de `cc_balances` y `cc_entries` antes, al confirmar, y al `Resolve` (REAL_EXECUTION), comparando con el criterio de la tabla H-013..H-016.
2. **Arbitraje A1–A2:** mismos criterios, costo/cobrado con y sin `PendingCash`, verificando ausencia o presencia de `pending_items` y filas en `cc_entries`.
3. Revisar consistencia con el **H-001** histórico (compra) tras los sprints de fix de Compra: si H-001 quedó obsoleto o parcialmente resuelto, enlazar y cerrar en `HALLAZGOS_AUDITORIA_SISTEMA.md`.

---

## Referencias de código (ancla)

| Tema | Archivo | Aprox. |
|------|---------|--------|
| Arbitraje: CC cobrado + profit | `arbitraje_service.go` | 115-185 |
| Transferencia: dual-leg CC | `transferencia_service.go` | 666-712 |
| Transferencia: signed + pending | `transferencia_service.go` | 842-910 |
| Transferencia: delivery + collections + fee | `transferencia_service.go` | 386-480 |
| Resolve CC diferido | `pending_service.go` | 222-238 |
| Simulación documental | `transferencia_cc_simulation_doc_test.go` | 1-32 |

---

*Generado: auditoría inicio 2026-04-27. Sin cambios de lógica en el repositorio.*
