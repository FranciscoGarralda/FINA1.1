# Prompt — Sprint cerrar hallazgos Arbitraje (`HALLAZGOS_AUDITORIA_ARBITRAJE.md`)

Copia el bloque **“Prompt para el agente”** abajo en un chat nuevo (modo Agent). Ajustá alcance si solo querés documentación o también código.

---

## Contexto obligatorio (leer antes de tocar código)

1. Plan maestro: `AUDITORIA_PLAN_MAESTRO.md` (§ 2.1 tabla CC/pendientes; § 1.2 E2E UI).
2. Hallazgos y estado mixto **histórico vs piloto**: `HALLAZGOS_AUDITORIA_ARBITRAJE.md`.
   - La tabla **“Resumen ejecutivo”** y la sección **“Tabla maestra vs Arbitraje actual”** describen comportamiento **previo al piloto**.
   - La sección **“Actualización — Piloto dos clientes”** y **“Auditoría plan maestro — ejecución 2026-04-30”** describen el **código actual**: `decideCompraLineEffect` / `decideVentaLineEffect`, sin `pending_items` cuando CC + pendiente CASH según tabla maestra, `cc_apply_on_resolve` simétrico en costo/cobrado, etc.
3. Implementación: `backend/internal/services/arbitraje_service.go` (`Execute`), helpers CC compartidos con Compra/Venta.
4. Piloto funcional: `docs/PILOTO_ARBITRAJE_DOS_CLIENTES.md`.
5. Script verificación datos: `scripts/audit-arbitraje-plan-mayor.sh`.

---

## Prompt para el agente

```
Objetivo: cerrar la deuda pendiente del módulo Arbitraje respecto de 
`HALLAZGOS_AUDITORIA_ARBITRAJE.md` y del plan maestro, sin romper ARB-A1..A6 
ya validados en DB (script audit-arbitraje-plan-mayor.sh) ni el cierre § 1.2 
UI documentado para ARB-A1.

### Fase 0 — Alineación documentación (obligatoria si no hay cambio de negocio)

1. Actualizar `HALLAZGOS_AUDITORIA_ARBITRAJE.md`:
   - La tabla “Resumen ejecutivo” debe reflejar el estado POST-PILOTO:
     - H-017 / H-019: cerradas o “Mitigadas” con referencia a la sección piloto 
       y al script ARB-A2/A3 (sin pending_items con CC+CASH pendiente cuando 
       corresponda tabla maestra).
     - H-018: “Parcial” o “Por decisión de producto”: explicitar que costo 
       **spot** con CC sigue **sin** `cc_entries` en la pata costo (comportamiento 
       documentado en piloto § spot); solo costo **pendiente** CC sigue patrón Compra OUT.
   - Corregir o marcar como histórica la tabla “Arbitraje no implementa…” del § 
     “Tabla maestra del plan maestro vs Arbitraje actual” si contradice la 
     implementación actual (ya aclarado más abajo en el mismo archivo).
   - Mantener H-023 como “Revisión negocio” hasta decisión explícita.

2. No inventar comportamiento nuevo en el markdown; solo igualar el texto al código.

### Fase 1 — Decisiones de producto pendientes (solo tras respuesta explícita del dueño del producto)

Si el usuario NO dio reglas nuevas, limitarte a documentar opciones en el hallazgo 
y NO cambiar `Execute()`.

**H-018 (costo spot + CC):** ¿El cliente costo con `cc_enabled` debe tener 
`cc_entries` en la pata OUT **spot** (equivalente a reflejar desembolso en CC), 
igual que en otros flujos, o la excepción del piloto (“solo cobrado + profit en CC”) 
es definitiva?

- Si es definitiva: documentar en `AUDITORIA_PLAN_MAESTRO.md` § excepción Arbitraje 
  § spot + actualizar smokes/tablas.
- Si debe alinearse a tabla maestra “REAL”: diseñar cambio en `Execute()` para 
  costo OUT spot con CC, actualizar tests y re-ejecutar script ARB-A1..A6 + E2E UI.

**H-023 (profit en CC además de cobrado):** Confirmar si la ganancia/pérdida debe 
seguir como línea CC separada atada al **cliente cobrado**, o fusionarse 
conceptualmente con el cobrado para evitar “doble lectura” en saldos.

- Sin decisión: solo smoke/documentación de la convención actual.

### Fase 2 — Mejoras UX / frontend (opcional, bajo riesgo)

1. `ClientSearchCombo` (`frontend/src/components/common/ClientSearchCombo.tsx`): 
   permitir búsqueda por código cuando el usuario escribe `#1` (normalizar query: 
   quitar `#` y matchear `client_code`). Mantener comportamiento actual para texto libre.
2. `ArbitrajeForm.tsx`: alinear copy de pendientes con `pendingTypeLabels` / mismo 
   criterio que Compra/Venta si el plan maestro § 2.3 lo exige (solo cosmética).

### Fase 3 — Verificación

- `go test ./...` en `backend/`.
- `npm run build` en `frontend/` si hubo cambios TS.
- Si hubo cambios en CC/líneas: re-ejecutar `scripts/audit-arbitraje-plan-mayor.sh` 
  y actualizar IDs de ejemplo en hallazgos solo si cambian fixtures.

### Restricciones

- Alcance mínimo: no refactor masivo fuera de Arbitraje/CC helpers ya usados ahí.
- No borrar comentarios ni tests salvo que queden redundantes tras el cambio.
- Responder en español en commits/docs tocados por esta sprint.

Entregables: diff acotado + lista corta “qué quedó decisión producto vs cerrado”.
```

---

## Checklist rápido para el dueño del producto (rellenar antes del código)

| ID | Pregunta | Opción A | Opción B |
|----|----------|----------|----------|
| H-018 | Costo OUT **spot** con cliente CC | Mantener piloto (sin CC en costo spot) | Alinear CC como Compra OUT REAL |
| H-023 | Profit CC separado vs cliente cobrado | Mantener (notas distintas en CC) | Unificar criterio / una sola entrada CC |

Sin marcar estas filas, el agente debe quedarse en **Fase 0 + verificación**.
