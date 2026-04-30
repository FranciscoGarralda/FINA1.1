# Prompt piloto — Arbitraje: dos clientes + pendientes como Compra/Venta

**Fecha:** 2026-04-29  
**Instrucción:** este archivo es **solo especificación**. No implica cambios en código hasta que el responsable lo autorice explícitamente.

---

## Alcance incluido (cuando se implemente)

1. **Dos clientes** por operación Arbitraje: uno asociado a la pata **costo (OUT)**, otro a **cobrado (IN)**.
2. **Pendientes y CC por pata** con la **misma matriz** que Compra/Venta:
   - **Costo OUT** → misma lógica que **Compra OUT** (`decideCompraLineEffect`).
   - **Cobrado IN** → misma lógica que **Venta IN** (`decideVentaLineEffect`).
3. **`cc_apply_on_resolve`:** cuando exista fila en `pending_items`, usar **`true`** en ambas patas (como Compra/Venta), **no** `false` en costo como hoy en Arbitraje.
4. **Tipos de pendiente:** alinear con Compra/Venta (p. ej. costo OUT pendiente → `PENDIENTE_DE_PAGO` con convención Compra OUT; cobrado IN pendiente → `PENDIENTE_DE_PAGO` como Venta IN — ver código fuente actual de `compra_service.go` / `venta_service.go`).
5. **UI:** para tipo ARBITRAJE, **no** usar el `ClientSearchCombo` único del encabezado del asistente; colocar **un selector de cliente antes** del bloque **costo** (antes del primer `<select>` de cuenta costo) y **otro antes** del bloque **cobrado** (antes del primer `<select>` de cuenta cobrado), p. ej. en `ArbitrajeForm.tsx` / coordinación con `NuevaOperacionPage.tsx`.
6. **`movements.client_id`:** definir política explícita para listados (recomendación acordada en conversación: sincronizar con **cliente cobrado** como cliente “principal” en cabecera para compatibilidad con pantallas que esperan un solo nombre).

---

## Reglas explícitas — patas sin pendiente (“spot”)

Evita ambigüedad entre la tabla maestra Compra/Venta (muchas patas “solo caja” cuando **no** hay pendiente) y el comportamiento histórico de Arbitraje.

| Caso | Decisión cerrada para este piloto |
|------|-----------------------------------|
| **Cobrado IN real** (`!cobradoPending`) y cliente cobrado con **CC** | **Mantener** el comportamiento actual de `arbitraje_service.go`: registrar CC en cobrado spot con la convención ya usada ahí (`ccSideIn`, nota tipo “Arbitraje — cobrado”). **No** empatar por defecto a Venta IN sin pendiente (allí la tabla maestra es “solo caja” en ese helper). Si el negocio quiere igualar a Venta en el futuro, será **cambio de producto explícito** (ticket aparte). |
| **Costo OUT real** (`!costoPending`) y cliente costo con **CC** | **No** introducir en este piloto un CC nuevo “tipo compra spot” sobre costo real más allá de lo que ya aplicará solo la matriz **pendiente** del costo. La tabla Compra OUT sin pendiente hoy es “solo caja” en ese flujo; mantener esa lectura hasta revisión contable que autorice CC en costo spot. |

---

## Persistencia wizard / SPA (`sessionStorage`)

| Ítem | Detalle |
|------|---------|
| Payload persistido | En `NuevaOperacionPage.tsx`, extender el objeto guardado en sesión (`WizardPersistedPayload` / `fina:nueva-operacion-wizard:…`) con **`arbitrajeCostClientId`** y **`arbitrajeCobradoClientId`** (además del `clientId` legacy innecesario para ARBITRAJE en cabecera global). |
| Objetivo | Que **F5** y **reingreso SPA** no pierdan los dos clientes antes de que el PATCH al servidor los persista. |
| Cabecera sincronizada | Ajustar **`lastSyncedHeaderRef`** (o el equivalente que compare “último estado enviado”) para incluir ambos IDs y así disparar PATCH cuando cambie cualquiera de los dos. |

---

## Reconstrucción de borrador y payloads

| Área | Detalle |
|------|---------|
| Backend `operation_service.go` | Revisar **`reconstructArbitrajeDraftData`** (y metadata de borrador relacionada): no asumir un único cliente; la fuente de verdad pasa a ser cabecera `movements` con **`arbitraje_cost_client_id`** / **`arbitraje_cobrado_client_id`** cuando existan. |
| Respuesta GET movimiento / detalle | El cliente debe poder hidratar ambos combos desde el JSON que devuelva el API tras **`handleResumeDraft`** o al abrir borrador guardado. |
| Borradores antiguos | Movimientos ARBITRAJE previos a la migración pueden tener ambos UUID **NULL**: definir UX (mensaje “completá cliente costo y cobrado”) y bloqueo de confirmación hasta completar. |

---

## Alcance excluido en primera entrega (piloto CC ganancia)

- **No implementar todavía** la regla discutida: “si no toco ganancia → CC profit ligado al cliente cobrado; si modifico ganancia → impacto según lo editado”.
- **Hasta nueva definición:** documentar como **pendiente de producto** y, si hace falta un comportamiento temporal, limitarlo a una línea explícita en el PR (“profit CC solo cliente cobrado” o “sin CC en profit”) sin presentarlo como regla final.

---

## Base de datos (cuando se autorice)

| Ítem | Detalle |
|------|---------|
| Migración nueva | `ALTER TABLE movements` ADD `arbitraje_cost_client_id UUID NULL REFERENCES clients(id)`, `arbitraje_cobrado_client_id UUID NULL REFERENCES clients(id)`. |
| Migración down | Eliminar ambas columnas. |
| Ejecución confirmación Arbitraje | Validar que ambos IDs estén presentes y activos antes de aplicar líneas. |

---

## Backend — cabecera y API (cuando se autorice)

| Archivo / área | Acción |
|----------------|--------|
| `operation_service.go` | Permitir crear borrador ARBITRAJE **sin** `client_id` obligatorio en cabecera global (como otros tipos opcionales); exigir los dos nuevos UUID al confirmar arbitraje o al PATCH cuando el negocio lo requiera. |
| `PatchMovementHeaderInput` (o equivalente) | Campos JSON opcionales: `arbitraje_cost_client_id`, `arbitraje_cobrado_client_id`; validar clientes activos. |
| `operation_repo.go` | Persistir columnas nuevas en UPDATE/CREATE según diseño elegido. |
| `movement_repo.go` / detalle movimiento | Devolver ambos IDs para reanudar borrador y auditoría en UI. |
| `arbitraje_service.go` `Execute` | Dejar de hacer `JOIN` un solo `m.client_id` para CC de todo el movimiento; leer costo/cobrado client + `cc_enabled` por cliente; aplicar efectos por pata como arriba. |

---

## Frontend (cuando se autorice)

| Archivo | Acción |
|---------|--------|
| `NuevaOperacionPage.tsx` | Estado para `arbitrajeCostClientId` y `arbitrajeCobradoClientId`; ocultar combo cliente global si `type === 'ARBITRAJE'`; sincronizar PATCH con backend; condición para crear borrador sin cliente único cuando tipo sea ARBITRAJE. |
| `ArbitrajeForm.tsx` | Dos combos cliente (costo / cobrado) en las posiciones DOM acordadas; impedir submit si falta alguno; mantener borrador coherente con API. |

*(Coordinar con § **Persistencia wizard / SPA** y § **Reconstrucción de borrador** más arriba.)*

---

## Verificación — matriz de variantes sugerida

Probar en entorno local (Postgres + API + frontend), con cuentas/divisas de prueba y clientes con y sin CC.

| # | CC costo | CC cobrado | Costo pend. | Cobrado pend. | Divisas costo/cobrado | Checks principales |
|---|----------|------------|-------------|---------------|----------------------|---------------------|
| 1 | Sí | Sí | No | No | Misma | Líneas caja + CC cobrado spot si aplica + profit según política temporal |
| 2 | Sí | Sí | Sí | No | Misma | Sin `pending_items` en costo si CC+pendiente (solo CC); cobrado según tabla |
| 3 | Sí | Sí | No | Sí | Misma | Simétrico en cobrado |
| 4 | Sí | Sí | Sí | Sí | Misma | Ambas patas según tabla maestra |
| 5 | No | No | Sí | Sí | Misma | Solo `pending_items`; `cc_apply_on_resolve` coherente |
| 6 | No | Sí | Variar | Variar | Misma | Mezcla por pata |
| 7 | Sí | No | Variar | Variar | Misma | Mezcla por pata |
| 8 | — | — | — | — | Distintas | Ganancia manual; cuenta/divisa/formato de ganancia |

Cruce obligatorio: para cada caso, comparar **SQL** (`movement_lines`, `pending_items`, `cc_entries`, `profit_entries`) con **UI** (`/posicion-caja`, `/posicion-integral`, `/posiciones`, `/pendientes` si hay pendientes).

---

## Orden sugerido de implementación (referencia)

1. Migración + repositorio cabecera + GET/PATCH movimiento + reconstrucción de borrador ARBITRAJE en `operation_service.go`.  
2. `arbitraje_service.Execute` + tests unitarios por matriz (incl. reglas § spot).  
3. Frontend dos clientes + persistencia wizard (`sessionStorage`) + integración manual tabla anterior.  
4. Actualizar `HALLAZGOS_AUDITORIA_ARBITRAJE.md` con resultado del piloto y decisión pendiente sobre CC de ganancia.

---

## Referencias de código actual (solo lectura)

- Tabla maestra efectos: `decideCompraLineEffect` en `backend/internal/services/compra_service.go`; `decideVentaLineEffect` en `backend/internal/services/venta_service.go`.
- Arbitraje actual: `backend/internal/services/arbitraje_service.go`.
- Pendientes al resolver CC diferido: `backend/internal/services/pending_service.go` (condición `CcApplyOnResolve`).
