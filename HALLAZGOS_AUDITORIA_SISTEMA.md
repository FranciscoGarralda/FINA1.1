# Hallazgos de auditoría del sistema Fina 1.1

> Documento de **solo registro**. NO se corrige nada acá. Sirve como backlog único de divergencias entre la lógica deseada (definida por el usuario) y la lógica actual del sistema. Luego se atacará uno por uno con su propio prompt/plan.

## Convenciones

- **ANTES / DESPUÉS:** saldos o estado observados en UI antes y después de la operación.
- **Libros observados:** Caja (`movement_lines`), Estado CC (`cc_entries`), Pendientes (`pending_items`), Movimientos, Inicio (dashboard), Reportes (Utilidad / Profit / Gastos / Resultado), Posición integral, Arqueos, Cuentas.
- **Severidad:**
  - 🔴 Crítico: afecta integridad contable, cuadre o doble impacto.
  - 🟠 Alto: divergencia clara con lógica deseada, impacto visible al operar.
  - 🟡 Medio: ambigüedad, UX confusa o inconsistencia entre módulos.
  - 🟢 Bajo: cosmético o reportable.

## Lógica deseada por el usuario (referencia)

Según lo conversado:

1. **Cliente con CC habilitada:** al crear una Compra/Venta, **ambas patas (IN y OUT)** deben impactar la CC del cliente (una positiva y una negativa) salvo que esa pata esté marcada como pendiente.
2. **Cliente con CC + pendiente marcado:** la pata pendiente NO debe impactar CC ni caja, queda como `pending_items`. La otra pata, si no es pendiente, sí impacta (caja + CC).
3. **Cliente sin CC:** solo el flujo real (caja + pendientes si aplica). **No** debería generar entradas en `cc_entries`.
4. **Ningún movimiento debería tener doble impacto** (ej. caja + pendiente simultáneamente sobre el mismo valor).

---

## Inventario de hallazgos

### H-001 — 🟠 Compra con cliente CC: el lado OUT no impacta Estado CC

- **Operación testigo:** Compra #9, cliente #4 (CC), IN USD Efectivo 100 (no pendiente), OUT ARS Efectivo 100.000 (no pendiente), cotización ARS = USD × 1.000.
- **Observado:**
  - Caja: USD Efectivo +100 ✅ / ARS Efectivo −100.000 ✅.
  - Estado CC #4: **USD +100** (solo lado IN). **ARS 0** (lado OUT no registrado).
  - Pendientes: 0 ✅.
- **Esperado (usuario):** Con cliente CC y ambas patas sin pendiente, **las dos** patas deben impactar CC (una +USD, una −ARS). Hoy solo impacta la pata IN.
- **Referencia código (análisis previo, no corregido):** `backend/internal/services/compra_service.go` invoca `applyCCImpactTx` únicamente para el IN leg; el OUT leg jamás llama a CC. En cambio `transferencia_service.go` sí lo aplica a ambas patas.
- **Líneas concretas responsables (`backend/internal/services/compra_service.go`):**
  - Líneas 137–141: bloque que aplica CC **solo al IN leg**:
    ```go
    if ccEnabled && !inPending {
        if err := applyCCImpactTx(ctx, s.ccSvc, tx, clientID, input.In.CurrencyID, input.In.Amount, movementID, ccSideIn, "Compra — divisa comprada", callerID); err != nil {
            return fmt.Errorf("apply cc impact IN: %w", err)
        }
    }
    ```
  - Líneas 144–159: loop de OUT lines que **nunca llama a `applyCCImpactTx`**. Falta acá el equivalente con `ccSideOut` cuando `ccEnabled && !outPending`.
- **Contrastar con:** `backend/internal/services/transferencia_service.go` (líneas ~666–677 según análisis previo) donde sí se invoca `applyCCImpactTx` para ambas patas IN y OUT.
- **Estado:** identificado, no corregido.

---

### H-002 — 🔴 Capital propio USD inflado en Posición integral por asimetría CC

- **Operación testigo:** misma #9 que H-001.
- **Observado en `/posicion-integral` (cotización manual USD/ARS = 1.000):**
  - Caja — Físico: ARS 9.900.000 + USD 10.100 → **20.000 USD equiv**.
  - Caja — Digital: ARS 10.000.000 + USD 10.000 → **20.000 USD equiv**.
  - **Total bruto caja: 40.000 USD** (antes era también 40.000 USD → compra simétrica no cambia bruto ✅).
  - **CC neta USD: +100,00** (consecuencia de H-001).
  - **Capital propio USD: 40.100,00** = Bruto 40.000 + CC 100 − Retiros 0.
- **Esperado:** una compra con ambos lados liquidados en caja **no debe cambiar el capital propio**. Debería seguir siendo 40.000 USD.
- **Causa raíz:** la fórmula `Capital = Bruto caja + CC neta − Retiros pendientes` sólo cierra si CC refleja deudas reales (pendientes o ventas a crédito). Con el bug de H-001, CC registra una "posición" que en realidad ya fue liquidada en caja ⇒ doble conteo que **infla el capital visible**.
- **Línea concreta que hace la suma (`frontend/src/pages/PosicionIntegralPage.tsx`):**
  - Línea 466:
    ```tsx
    const capitalPropioUsd = totalBrutoUsd + deudaCcNetaUsd - retirosPendUsd;
    ```
  - `deudaCcNetaUsd` viene de `ccRows` (endpoint de Estado CC) sumando todas las divisas convertidas a USD por `arsPerUsd` (línea 456–464). Por eso, si H-001 deja CC asimétrica (solo una pata), esta línea 466 convierte esa asimetría en un capital inflado.
- **Impacto:** reporte de capital falso al operar con clientes CC en compra/venta sin pendientes. Crítico porque **engaña al dueño del negocio** sobre cuánto capital tiene.
- **Depende de:** corregir H-001 probablemente disuelve H-002 (al quedar CC simétrica, `deudaCcNetaUsd` vale 0 para operaciones liquidadas y la fórmula de línea 466 vuelve a ser correcta). A revalidar luego.
- **Estado:** identificado, no corregido.

---

### H-003 — 🟢 Saltos en la numeración de operaciones

- **Observado:** en `/movimientos` solo aparecen #3, #5, #9, #10 (faltan #1, #2, #4, #6, #7, #8).
- **Causa probable:** los borradores reservan número desde el backend al crearse; al eliminarse/cancelarse el número queda "quemado".
- **Impacto:** cosmético / auditoría. Un auditor externo puede preguntar por qué faltan números.
- **Decisión de diseño:** posiblemente aceptado por el equipo. Solo se registra para que el usuario confirme si es intencional.
- **Estado:** observación, pendiente decisión de diseño.

---

### H-004 — 🟠 Pendiente IN de compra (USD a recibir) se contabiliza como "Retiro pendiente" que RESTA del capital propio

- **Operación testigo:** Compra #10, cliente #4 (CC), IN USD Efectivo 100 **pendiente de retiro**, OUT ARS Efectivo 100.000 no pendiente.
- **Observado en `/posicion-integral` (cotización USD/ARS = 1.000):**
  - Caja — Físico: ARS 9.800.000 + USD 10.100 → **19.900 USD equiv** (cae 100 USD por OUT).
  - Caja — Digital: 20.000 USD equiv (sin cambios).
  - **Total bruto caja: 39.900 USD**.
  - **CC neta USD: +100,00** (herencia de A1, no debería estar presente — ver H-001/H-002).
  - **Retiros pendientes USD: 100,00** (el pendiente IN de A2 cuenta acá).
  - **Capital propio USD: 39.900,00** = 39.900 + 100 − 100.
- **Esperado (semántico):** En una **compra**, "pendiente de retiro" significa *"la casa todavía debe retirar / recibir el USD del cliente"*. Es un derecho a cobrar (a favor de la casa). Debería **sumar** al capital propio, no restar.
  - Capital esperado real: 39.900 + 100 (USD por recibir) = **40.000 USD**, idéntico al estado pre-A2.
- **Causa raíz semántica (confirmada con código):** la función `pendingTypeLabel` en `frontend/src/utils/pendingTypeLabels.ts` (líneas 7–12) etiqueta `PENDIENTE_DE_RETIRO` como `"Retiro"` cuando el movimiento NO es VENTA (por defecto). Luego `PosicionIntegralPage.tsx` mete cualquier label `"Retiro"` en `pendRetiroRows` (líneas 378–380 vía `isPendingUserFacingRetiro`), y la fórmula del capital los **resta**. El bucket "Retiro" mezcla dos cosas opuestas: (a) Retiro de Capital pendiente (la casa debe entregar dinero, RESTA correctamente) y (b) IN pendiente de Compra (la casa debe RECIBIR dinero, NO debería restar).
- **Líneas concretas responsables:**
  - `frontend/src/utils/pendingTypeLabels.ts` líneas 7–12: clasificación que produce label `"Retiro"` para PENDIENTE_DE_RETIRO sin importar si nace de Compra o Retiro de Capital.
  - `frontend/src/pages/PosicionIntegralPage.tsx`, línea 466: `const capitalPropioUsd = totalBrutoUsd + deudaCcNetaUsd - retirosPendUsd;` — el `- retirosPendUsd` aplica indiscriminadamente a todos los pendientes label "Retiro".
- **Impacto cruzado con H-001/H-002:** En A2 los dos errores se compensan: CC neta +100 (mal sumado, por H-001 herencia A1) cancela el "Retiros pendientes 100" (mal restado, por H-004), dando 39.900. Es coincidencia, no diseño correcto.
- **Estado:** identificado, no corregido.

---

### H-005 — 🔴 Pendiente OUT de compra ("Pago") es huérfano: no aparece en ningún bucket del Capital propio

- **Operación testigo:** Compra #11, cliente #4 (CC), IN USD Efectivo 100 no pendiente, OUT ARS Efectivo 100.000 **pendiente de pago**.
- **Observado en `/posicion-integral` (cotización USD/ARS = 1.000):**
  - Caja — Físico: ARS 9.800.000 + USD 10.200 → 20.000 USD equiv.
  - Caja — Digital: 20.000 USD equiv.
  - **Total bruto: 40.000 USD**.
  - **CC neta USD: +200,00** (+100 fantasma de A1 H-001, +100 real por IN A3).
  - **Retiros pendientes USD: 100,00** (sigue el pendiente IN de A2; el "Pago" pendiente A3 NO suma acá).
  - **Entregas pendientes USD: 0,00** (con leyenda explícita "No resta del capital").
  - **Capital propio USD: 40.100,00** = 40.000 + 200 − 100.
- **Esperado:** El pendiente OUT de A3 es ARS 100.000 (= 100 USD) que la casa **debe entregar al cliente**. Es una obligación real. Debería restar del capital. Capital esperado real: **40.000 USD** (estado pre-A1, ya que A1+A2+A3 son operaciones balanceadas/pendientes que no deberían modificar el patrimonio).
- **Causa raíz (taxonomía rota):** el mapeo en `frontend/src/utils/pendingTypeLabels.ts`:
  - `PENDIENTE_DE_RETIRO` + `COMPRA` → label **"Retiro"** → entra a `retirosPendUsd` → RESTA (H-004).
  - `PENDIENTE_DE_PAGO` + `COMPRA` → label **"Pago"** → NO matchea ni `"Retiro"` (línea 19–21) ni `"Entrega"` (línea 24–26) → **huérfano**, no entra a ningún bucket.
  - `PENDIENTE_DE_RETIRO` + `VENTA` → label "Entrega" → entra a `entregasPendUsd` → NO RESTA (también problemático).
  - `PENDIENTE_DE_PAGO` + `VENTA` → label "Retiro" → entra a `retirosPendUsd` → RESTA.
- **Líneas concretas responsables:**
  - `frontend/src/utils/pendingTypeLabels.ts` líneas 7–12: la rama por defecto (cuando `movementType !== 'VENTA'`) devuelve `"Pago"` para `PENDIENTE_DE_PAGO` y `"Retiro"` para `PENDIENTE_DE_RETIRO`. Solo `"Retiro"` y `"Entrega"` son reconocidos por las funciones `isPendingUserFacing*` (líneas 19–26).
  - `frontend/src/pages/PosicionIntegralPage.tsx` líneas 378–383: filtra `pendRetiroRows` y `pendEntregaRows` con `isPendingUserFacingRetiro`/`isPendingUserFacingEntrega`. Cualquier pendiente con label "Pago" cae al vacío.
- **Diseño explícito visible en UI:** la cabecera dice *"Las entregas pendientes se listan aparte y no restan del capital"* (líneas 658–659 de `PosicionIntegralPage.tsx`), confirmando que existe la decisión de no restarlas. Pero esto deja al pendiente "Pago" de compras sin bucket alguno.
- **Impacto:** capital propio falsamente alto cuando hay compras con OUT pendiente de pago (deudas no contabilizadas).
- **Decisión pendiente:** definir si el "Pago" pendiente debe entrar a `retirosPendUsd` (restar, equivalente conceptual a un retiro de capital pendiente) o a un nuevo bucket "Deudas pendientes" que también reste. Y reevaluar si "Entregas pendientes" (VENTA con divisa por entregar) deberían también restar del capital, dado que son obligaciones reales.
- **Estado:** identificado, no corregido.

---

### H-006 — 🟡 "Retiros pendientes" mezcla obligaciones y cuentas por cobrar (taxonomía imprecisa)

- **Observado tras A4:** `/posicion-integral` muestra `Retiros pendientes USD: 200,00`. Ese bucket agrupa **dos** pendientes `PENDIENTE_DE_RETIRO` de naturaleza opuesta:
  - **A2:** IN pendiente de retiro. Semántica real: casa debe RECIBIR 100 USD del cliente → es una **cuenta por cobrar** (a favor de la casa).
  - **A4:** IN pendiente de retiro (ídem). También cuenta por cobrar.
  - Nota: hoy en la data de prueba no hay "Retiro de Capital" pendiente, pero si existiera caería también en el mismo bucket con semántica inversa (casa **debe entregar** dinero).
- **Efecto actual:** la fórmula `Capital = Bruto + CCneta − RetirosPend` resta ambos tipos. Para las cuentas por cobrar (A2, A4) eso es incorrecto (deberían sumar o no tocar) ⇒ es la continuación natural de H-004, ampliada. La etiqueta "Retiro" visible en UI no distingue origen (Compra IN vs Retiro de Capital), lo que también lleva a UX confusa.
- **Líneas concretas:**
  - `frontend/src/utils/pendingTypeLabels.ts` 7–12: el label depende sólo de `type + movementType`. Un `PENDIENTE_DE_RETIRO` que nace de `COMPRA` devuelve `"Retiro"`, igual que uno que nace de `RETIRO_CAPITAL`.
  - `frontend/src/pages/PosicionIntegralPage.tsx` 378–380: `setPendRetiroRows(pending.filter(isPendingUserFacingRetiro))`. Sin separar por `movementType`.
  - Línea 466 ya citada.
- **Sugerencia (para cuando se ataquen los fixes):** separar el bucket por `movementType` o cambiar el label: "Cobrar" (compra IN pendiente) vs "Retiro" (retiro de capital pendiente). Esto también hará consistente el naming para el usuario final.
- **Estado:** identificado, no corregido.

---

## Verificaciones hechas hasta acá (A1, A2, A3, A4, A5)

Sistema revisado tras Compra #9 (A1) y Compra #10 (A2):

**A1 (sin pendientes):**
- ✅ `/posicion-caja` — refleja bien los movement_lines.
- ⚠️ `/posiciones` (Estado CC) — ver H-001.
- ✅ `/pendientes` — sin pendientes (ninguno marcado).
- ✅ `/inicio` — Utilidad/Gastos/Resultado 0. Correcto para compra aislada (utilidad solo se realiza al vender).
- ✅ `/movimientos` — operación #9 listada CONFIRMADA (con H-003).
- 🔴 `/posicion-integral` — ver H-002.
- ✅ `/cuentas` — solo lista nombres.
- ➖ `/caja-arqueos` — no aplica.

**A2 (IN pendiente de retiro):**
- ✅ `/posicion-caja` — ARS Efectivo −100.000 (OUT salió), USD sin cambios (IN pendiente no entró).
- ⚠️ `/posiciones` (Estado CC #4) — sigue USD +100 herencia de A1. La pata OUT no tocó CC ⇒ se confirma H-001 también para A2.
- ✅ `/pendientes` — 1 Retiro USD 100 cliente 1,1 (Abierto). Correcto.
- ✅ `/inicio` — Utilidad/Gastos/Resultado 0.
- ✅ `/movimientos` — operación #10 CONFIRMADA + etiqueta "Pendiente". H-003 sigue (#1, #2, #4, #6, #7, #8 ausentes).
- 🟠 `/posicion-integral` — Capital propio 39.900 USD = 39.900 + 100 (CC herencia) − 100 (retiro pend.). Compensación accidental que oculta el bug real ⇒ se introduce H-004.
- ✅ `/cuentas` — sin cambios.
- ➖ `/caja-arqueos` — no aplica.

**A4 (ambas patas pendientes):**
- ✅ `/posicion-caja` — sin cambios (ninguna pata toca caja).
- ✅ `/posiciones` (Estado CC #4) — sigue USD +200 (sin cambios respecto a A3). Las patas pendientes no tocaron CC.
- ✅ `/pendientes` — 4 Abiertos: Retiro USD 100 (A2), Pago ARS 100.000 (A3), **Retiro USD 100 (A4)**, **Pago ARS 100.000 (A4)**. Los dos nuevos se crearon correctamente.
- ✅ `/inicio` — Utilidad/Gastos/Resultado 0.
- ✅ `/movimientos` — operación #12 CONFIRMADA + etiqueta "Pendiente". H-003 persiste (ahora también sin #10 entre medio no, ya está; faltan #1, #2, #4, #6, #7, #8).
- 🔴 `/posicion-integral` — **Capital propio USD 40.000,00** = 40.000 + 200 (CC neta) − 200 (Retiros pend.). Compensación accidental: el capital parece correcto pero el desglose es incorrecto (CC inflada por H-001, Retiros mezclando obligación con cuenta por cobrar ⇒ H-006). Además los dos "Pago ARS 100.000" (A3 + A4) siguen sin aparecer en ningún bucket ⇒ ratifica H-005.
- ✅ `/cuentas` — sin cambios.
- ➖ `/caja-arqueos` — no aplica.

**A3 (OUT pendiente de pago):**
- ✅ `/posicion-caja` — USD Efectivo +100 (10.100→10.200, IN no pendiente entró), ARS sin cambios (OUT pendiente no salió).
- ✅ `/posiciones` (Estado CC #4) — USD +200 = +100 herencia A1 + +100 nueva por IN A3 no pendiente. La pata OUT pendiente NO tocó CC, lo cual coincide con la lógica deseada del usuario en este caso particular (porque era pendiente).
- ✅ `/pendientes` — 2: Retiro USD 100 (A2) + Pago ARS 100.000 (A3), ambos Abierto.
- ✅ `/inicio` — Utilidad/Gastos/Resultado 0.
- ✅ `/movimientos` — operación #11 CONFIRMADA + etiqueta "Pendiente".
- 🔴 `/posicion-integral` — Capital propio 40.100 USD = 40.000 + 200 − 100. El pendiente "Pago" ARS 100k de A3 no aparece en ningún bucket ⇒ se introduce **H-005** (taxonomía huérfana de pendientes Pago de COMPRA).
- ✅ `/cuentas` — sin cambios.
- ➖ `/caja-arqueos` — no aplica.

**A5 (IN USD Digital 100, OUT ARS Digital 100.000, sin pendientes):**
- ✅ UI form: al elegir formato `Digital`, los checkboxes "Pendiente de retiro" y "Pendiente de pago" aparecen **deshabilitados** (`disabled`). Confirma la decisión de producto: sin pendientes en cuentas digitales. Fuente: `frontend/src/components/operations/CompraForm.tsx` (y similar para el form de Venta/Arbitraje; no inspeccionado en esta ronda — registrar como consistencia).
- ✅ `/posicion-caja` — USD dig 10.000 → **10.100** (+100 por IN), ARS dig 10.000.000 → **9.900.000** (−100.000 por OUT). Saldos efectivo sin cambios.
- ⚠️ `/posiciones` (Estado CC #4) — USD **+300,00** (subió de +200 a +300). Solo la pata IN (+100 USD) impactó CC; la pata OUT (−100.000 ARS) NO impactó CC ⇒ **H-001 se reproduce idéntico para formato Digital**, confirmando que la asimetría es independiente del formato (`CASH` o `DIGITAL`).
- ✅ `/pendientes` — sigue en 4 Abiertos, sin nuevos (correcto, ningún pendiente posible en Digital).
- ✅ `/inicio` — Utilidad/Gastos/Resultado 0.
- ✅ `/movimientos` — operación #13 CONFIRMADA, **sin** etiqueta "Pendiente". H-003 sigue (faltan #1, #2, #4, #6, #7, #8).
- 🟠 `/posicion-integral` — Capital propio **40.100,00 USD** = 40.000 + 300 − 200. Sigue inflado +100 vs esperado (40.000). Es la manifestación directa de H-002 sumada sobre la inflación previa; Digital no cambia el comportamiento.
- ✅ `/cuentas` — sin cambios.
- ➖ `/caja-arqueos` — no aplica.

> **Nota cruzada (A1 + A5):** los dos casos "sin pendientes" (A1 Efectivo, A5 Digital) generan el mismo síntoma: CC +100 fantasma, Capital +100 inflado. Esto ratifica que la causa raíz es única (H-001 en `compra_service.go` líneas 137–141 vs loop OUT 144–159) y no depende del formato ni de la cuenta.

**A6 (IN USD Efectivo 100, OUT ARS Digital 100.000, sin pendientes — formato mixto):**
- ✅ UI form: con IN = Efectivo, el checkbox "Pendiente de retiro" queda habilitado (readonly = no marcado); con OUT = Digital, el checkbox "Pendiente de pago" pasa a `disabled`. Cada pata se rige por su propio formato ⇒ comportamiento simétrico con A5 en ese aspecto (el disabling es por línea, no global a la operación).
- ✅ `/posicion-caja` — USD Efectivo 10.200 → **10.300** (+100 por IN ef.), ARS Digital 9.900.000 → **9.800.000** (−100.000 por OUT dig.). USD Digital y ARS Efectivo sin cambios. Ambas patas impactaron la caja real, cada una en su "compartimento".
- ⚠️ `/posiciones` (Estado CC #4) — USD **+400,00** (subió de +300 a +400). Solo la pata IN (+100 USD) tocó CC; la pata OUT (−100.000 ARS Digital) NO tocó CC. ⇒ **H-001 se vuelve a reproducir** también en formato mixto. La asimetría es independiente de si el OUT es Efectivo o Digital (A1 ef/ef, A5 dig/dig, A6 ef/dig → mismo patrón).
- ✅ `/pendientes` — 4 Abiertos, ninguno nuevo (correcto, ningún pendiente posible en A6).
- ✅ `/inicio` — Utilidad/Gastos/Resultado 0,00 ARS (correcto para compra aislada sin venta posterior).
- ✅ `/movimientos` — operación **#14** CONFIRMADA, **sin** etiqueta "Pendiente". H-003 persiste (siguen faltando #1, #2, #4, #6, #7, #8).
- 🟠 `/posicion-integral` — Total bruto USD **40.000,00** (el neto en USD-equiv. de +100 USD ef. y −100.000 ARS dig. al TC 1.000 es 0). CC neta USD **400,00**. Retiros pendientes USD **200,00**. **Capital propio USD 40.200,00** = 40.000 + 400 − 200. Sigue inflado +200 USD vs esperado (40.000). Delta A6 = +100 USD respecto al capital tras A5 (40.100) ⇒ cada compra "sin pendientes" agrega +100 USD de inflación, independientemente del formato. Ratifica H-002 sumado a A1 y A5.
- ✅ `/cuentas` — sin cambios.
- ➖ `/caja-arqueos` — no aplica.

> **Nota cruzada (A1 + A5 + A6):** los tres casos "sin pendientes" con distintos formatos (ef/ef, dig/dig, ef/dig) reproducen exactamente el mismo patrón: CC +100 USD fantasma, Capital +100 USD inflado. La causa raíz está 100% confirmada en `compra_service.go` líneas 137–141 (IN aplica `applyCCImpactTx`) vs loop OUT 144–159 (OUT **no** lo aplica). No interviene el formato, ni la cuenta, ni la direccionalidad entre efectivo/digital.

**A7 (IN USD Digital 100, OUT ARS Efectivo 100.000, sin pendientes — formato mixto inverso):**
- ✅ UI form: con IN = Digital, "Pendiente de retiro" aparece `disabled`; con OUT = Efectivo, "Pendiente de pago" queda habilitado (sin marcar). Comportamiento inverso a A6 y coherente con la regla "solo efectivo admite pendientes".
- ✅ `/posicion-caja` — USD Digital 10.100 → **10.200** (+100 por IN dig.), ARS Efectivo 9.800.000 → **9.700.000** (−100.000 por OUT ef.). USD Efectivo y ARS Digital sin cambios. Ambas patas impactaron correctamente su compartimento.
- ⚠️ `/posiciones` (Estado CC #4) — USD **+500,00** (subió de +400 a +500). Solo la pata IN (+100 USD Digital) impactó CC; la pata OUT (−100.000 ARS Efectivo) NO tocó CC ⇒ **H-001 se reproduce idéntico en formato mixto inverso**. Queda definitivamente confirmado que la asimetría es **independiente del formato de cualquiera de las patas**.
- ✅ `/pendientes` — 4 Abiertos, sin nuevos (correcto, ninguno fue marcado en A7).
- ✅ `/inicio` — Utilidad/Gastos/Resultado 0,00 ARS.
- ✅ `/movimientos` — operación **#15** CONFIRMADA, **sin** etiqueta "Pendiente". H-003 persiste (siguen faltando #1, #2, #4, #6, #7, #8).
- 🟠 `/posicion-integral` — Total bruto USD **40.000,00**. CC neta USD **500,00**. Retiros pendientes USD **200,00**. **Capital propio USD 40.300,00** = 40.000 + 500 − 200. Delta A7 = +100 USD respecto A6 (40.200). Confirma H-002 sumando el mismo patrón fijo de inflación por compra sin pendientes.
- ✅ `/cuentas` — sin cambios.
- ➖ `/caja-arqueos` — no aplica.

> **Cierre de Fase A (A1..A7, cliente CC):** las 7 variantes testadas confirman que, con cliente CC:
> 1. **H-001** es **total y sistemáticamente** asimétrica: en compras, sólo la pata IN no pendiente impacta CC; la pata OUT no pendiente **jamás** toca CC, sin importar divisa, cuenta o formato.
> 2. Cada compra "sin pendientes" suma +100 USD fantasma a la CC del cliente y +100 USD de inflación al Capital propio (H-002).
> 3. El diseño de UI bloquea correctamente los checkboxes de pendientes cuando cualquiera de las patas está en Digital (regla por línea, no global).
> 4. Los pendientes se crean sólo cuando se marcan explícitamente en patas Efectivo; los tipos `PENDIENTE_DE_RETIRO` y `PENDIENTE_DE_PAGO` generan los bugs H-004/H-005/H-006 en `/posicion-integral`.
> 5. `/inicio` y `Utilidad` no se ven afectados (la utilidad sólo se realiza al vender, no al comprar) ⇒ coherente con la lógica FX inventory.

**B1 (cliente #1 SIN CC, IN USD Efectivo 100, OUT ARS Efectivo 100.000, sin pendientes):**
- ✅ UI form: idéntica al caso CC (cliente sin CC no altera el form); ambos checkboxes "Pendiente" quedan habilitados (readonly) y sin marcar.
- ✅ `/posicion-caja` — USD Efectivo 10.300 → **10.400** (+100 por IN ef.), ARS Efectivo 9.700.000 → **9.600.000** (−100.000 por OUT ef.). Ambas patas impactan caja real, correcto.
- ✅ `/posiciones` (Estado CC) — **sin cambios**: sigue apareciendo sólo el cliente #4 con USD +500 (herencia fase A). El cliente #1 (sin CC) **no genera ningún `cc_entries`** ⇒ comportamiento coherente con `ccEnabled=false` en `backend/internal/services/operation_helpers.go` (líneas 18–29, `lookupMovementForExecution` trae `c.cc_enabled`) y con el guard `if ccEnabled && !inPending` en `compra_service.go` línea 137 (al ser `false`, nunca se invoca `applyCCImpactTx`). **H-001 NO aplica a clientes sin CC** — queda ratificado por contraste.
- ✅ `/pendientes` — 4 Abiertos (los mismos de fase A), ninguno nuevo (correcto, sin pendientes marcados).
- ✅ `/inicio` — Utilidad/Gastos/Resultado 0,00 ARS (compra aislada sin venta).
- ✅ `/movimientos` — operación **#16** CONFIRMADA, **sin** etiqueta "Pendiente". H-003 persiste.
- ✅ `/posicion-integral` — Total bruto USD **40.000,00** (compra balanceada: −100.000 ARS/1000 + +100 USD = 0 neto). CC neta USD **500,00** (sin cambios vs. cierre de Fase A). Retiros pendientes USD **200,00** (sin cambios). **Capital propio USD 40.300,00** = 40.000 + 500 − 200. **Delta B1 = 0 USD** respecto al cierre de A7. **Este es el comportamiento deseado**: cliente sin CC, sin pendientes, ambas patas liquidadas en caja ⇒ capital no se mueve. Por primera vez en la auditoría, **una compra no genera inflación extra**. Contraste directo con A1/A5/A6/A7 (cliente CC, mismo escenario sin pendientes) que sí inflaban +100 USD cada una.
- ✅ `/cuentas` — sin cambios.
- ➖ `/caja-arqueos` — sigue vacío, no aplica.

> **Hallazgo positivo B1:** el flujo "cliente sin CC, sin pendientes" funciona **exactamente** como el usuario describió (balance a balance de caja, sin CC, sin pendientes). Confirma por contraste que H-001/H-002 son bugs ligados a `ccEnabled=true`, no a la operación Compra per se. No se registra nueva advertencia a partir de B1.

**B2 (cliente #1 SIN CC, IN USD Efectivo 100 pendiente de retiro, OUT ARS Efectivo 100.000 no pendiente):**
- ✅ UI form: al cliente sin CC no se le cambia nada en el form. "Pendiente de retiro" se deja marcar sin trabas.
- ✅ `/posicion-caja` — ARS Efectivo 9.600.000 → **9.500.000** (−100.000 por OUT ef. no pendiente). USD Efectivo **sin cambios** (10.400; IN pendiente no entró). ARS Digital y USD Digital sin cambios.
- ✅ `/posiciones` (Estado CC) — **sin cambios**: sólo sigue #4 con USD +500. El cliente #1 no registra CC ⇒ ratifica: H-001 no aplica a clientes sin CC.
- ⚠️ `/pendientes` — **5 Abiertos** (uno nuevo): **Retiro USD 100**, cliente 1,1 (#1), 24/04 18:41.
  - **Observación UX:** el nuevo pendiente muestra **solo** los botones "Resolver" y "Anular op.", **sin** "Compensar" (que sí aparece en los 4 de cliente #4 CC). El botón "Compensar" parece condicionado a `cc_enabled=true`. Coherente, pero queda registrado.
- ✅ `/inicio` — Utilidad/Gastos/Resultado 0,00 ARS.
- ✅ `/movimientos` — operación **#17** CONFIRMADA + etiqueta "Pendiente".
- 🔴 `/posicion-integral` — Total bruto USD **39.900,00** (19.900 físico + 20.000 digital; cayó −100 vs B1 por OUT ef.). CC neta USD **500,00** (sin cambios; herencia fase A). Retiros pendientes USD **300,00** (antes 200; +100 por el nuevo Retiro USD 100 de B2). **Capital propio USD 40.100,00** = 39.900 + 500 − 300.
  - **Delta B1→B2 = −200 USD** para una operación que semánticamente es un intercambio **neutro** (la casa entrega 100.000 ARS = 100 USD equiv y recibe un **derecho a cobrar** de 100 USD; patrimonio neto no debería variar → capital esperado seguiría en 40.300).
  - **Descomposición del −200 USD aparente:**
    - Bruto cae −100 USD (por OUT que salió sin IN compensante) ✅ correcto contablemente; el USD del IN está "en camino" como cuenta por cobrar.
    - Retiros pendientes sube +100 USD (el nuevo "Retiro" resta del capital) ❌ — el pendiente IN de una Compra es una **cuenta por cobrar** que debería SUMAR (o al menos no RESTAR).
    - Total: el mismo derecho sobre 100 USD cuenta "dos veces en contra" del capital (se fue de caja **y** se registra como retiro pendiente que resta).
  - **Ratifica H-004** con contraste limpio: en A2 (cliente CC) el error H-004 (−100) quedaba enmascarado por H-001 (+100 CC fantasma) dando 39.900 aparente; en B2 (cliente sin CC) H-001 no aplica y el gap se expone sin compensación.
- ✅ `/cuentas` — sin cambios.
- ➖ `/caja-arqueos` — no aplica.

> **Refuerzo de H-004 a partir de B2:** el bug es **independiente de `cc_enabled`** y existe también en clientes sin CC. B2 es el primer caso donde H-004 aparece aislado de H-001/H-002 ⇒ confirma que la causa raíz está en `frontend/src/utils/pendingTypeLabels.ts` (líneas 7–12) + la fórmula de `frontend/src/pages/PosicionIntegralPage.tsx` línea 466, no en la lógica CC. Severidad efectiva real: **−200 USD por operación** sobre el capital visible. Proponer **re-clasificar H-004 de 🟠 Alto a 🔴 Crítico** cuando se arme el plan de fix (decisión pendiente del usuario).

**B3 (cliente #1 SIN CC, IN USD Efectivo 100 no pendiente, OUT ARS Efectivo 100.000 pendiente de pago):**
- ✅ UI form: con cliente sin CC y formato Efectivo en ambas patas, los dos checkboxes "Pendiente" quedan habilitados; se marca "Pendiente de pago" en OUT sin trabas.
- ✅ `/posicion-caja` — USD Efectivo 10.400 → **10.500** (+100 por IN ef. no pendiente). ARS Efectivo **sin cambios** (9.500.000; OUT pendiente no salió de caja). USD Digital y ARS Digital sin cambios. Comportamiento coherente con la regla "pendiente = no toca caja".
- ✅ `/posiciones` (Estado CC) — **sin cambios**: sigue sólo #4 con USD +500. El cliente #1 (sin CC) no genera `cc_entries`. Ratifica una vez más que H-001 no aplica a `cc_enabled=false`.
- ⚠️ `/pendientes` — **6 Abiertos** (uno nuevo): **Pago ARS 100.000**, cliente 1,1 (#1), 24/04 18:49.
  - **Observación UX (consistente con B2):** el nuevo pendiente muestra solo "Resolver" y "Anular op.", **sin** "Compensar". Confirma que "Compensar" es exclusivo de clientes con `cc_enabled=true`.
- ✅ `/inicio` — Utilidad/Gastos/Resultado 0,00 ARS (compra aislada, la utilidad FX inventory sólo se realiza al vender).
- ✅ `/movimientos` — operación **#18** CONFIRMADA + etiqueta "Pendiente" (porque el OUT es pendiente). H-003 persiste.
- 🔴 `/posicion-integral` — Total bruto USD **40.000,00** (20.000 físico + 20.000 digital; vs. B2 subió +100 por el IN que entró). CC neta USD **500,00** (sin cambios). Retiros pendientes USD **300,00** (sin cambios: el nuevo pendiente tipo PAGO no entra a este bucket). Entregas pendientes USD **0,00**. **Capital propio USD 40.200,00** = 40.000 + 500 − 300.
  - **Delta B2→B3 = +100 USD**, para una operación que semánticamente es **neutra** (entró 100 USD físico a caja pero la casa quedó debiendo ARS 100.000 = 100 USD equiv.). Capital esperado: 40.100 sin cambios (o volver a 40.300 si descontamos también el error heredado de B2). Observado: +100 USD extra.
  - **Descomposición del +100 USD aparente:**
    - Bruto sube +100 USD (por IN ef. que entró) ✅ correcto contablemente; el USD ingresó a caja.
    - Retiros pendientes **no cambia** ❌ — el pendiente "Pago ARS 100.000" (= 100 USD equiv.) es una **obligación real** pero no entra a ningún bucket de Posición integral (cae en el label "Pago", huérfano). Así la deuda comercial nunca se refleja.
    - Total: el capital refleja el ingreso a caja pero **ignora** la obligación equivalente ⇒ Capital inflado +100 USD.
  - **Ratifica H-005 en aislamiento total** (sin mezcla con H-001/H-002/H-004): el pendiente OUT tipo PAGO de una Compra no entra a `retirosPendUsd` (label "Pago" no matchea `isPendingUserFacingRetiro`) ni a `entregasPendUsd` (tampoco matchea `isPendingUserFacingEntrega`). Causa raíz en `frontend/src/utils/pendingTypeLabels.ts` líneas 7–12 + `frontend/src/pages/PosicionIntegralPage.tsx` líneas 378–383 + 466.
  - **Contraste B2 vs B3 (limpio, sin CC):** dos operaciones semánticamente neutras producen deltas opuestos al capital —B2 = **−200 USD** (H-004: derecho a cobrar restado como retiro), B3 = **+100 USD** (H-005: deuda comercial ignorada)— **en la misma página y por la misma lógica de etiquetado**. Confirma que H-004 y H-005 son dos caras del mismo defecto taxonómico en `pendingTypeLabels.ts`.
- ✅ `/cuentas` — sin cambios.
- ➖ `/caja-arqueos` — no aplica.

> **Refuerzo de H-005 a partir de B3:** el bug es **independiente de `cc_enabled`** (ya estaba evidenciado en A3/A4 con cliente CC, B3 lo ratifica con cliente sin CC). El pendiente "Pago" de una Compra es **siempre** una obligación real y nunca aparece en Posición integral. Severidad confirmada: 🔴 Crítico (oculta deudas reales del patrimonio). Sugerencia de fix pendiente: mover "Pago" de Compra a `retirosPendUsd` (o crear bucket "Deudas pendientes" propio que reste).

**B4 (cliente #1 SIN CC, IN USD Efectivo 100 pendiente de retiro, OUT ARS Efectivo 100.000 pendiente de pago — AMBAS patas pendientes):**
- ✅ UI form: ambos checkboxes "Pendiente" se pueden marcar sin trabas (cliente sin CC, formato Efectivo en ambos lados).
- ✅ `/posicion-caja` — **sin cambios** respecto a B3 (ARS Ef 9.500.000, ARS Dig 9.800.000, USD Ef 10.500, USD Dig 10.200). Ninguna pata tocó caja, coherente con regla "pendiente = no impacta caja".
- ✅ `/posiciones` (Estado CC) — **sin cambios**: sólo cliente #4 con USD +500. Ratifica H-001 no aplica.
- ⚠️ `/pendientes` — **8 Abiertos** (dos nuevos): **Retiro USD 100** (24/04 18:55) y **Pago ARS 100.000** (24/04 18:55), ambos cliente 1,1 (#1), ambos solo con botones "Resolver" y "Anular op." (sin Compensar) coherente con `cc_enabled=false`.
- ✅ `/inicio` — Utilidad/Gastos/Resultado 0,00 ARS.
- ✅ `/movimientos` — operación **#19** CONFIRMADA + etiqueta "Pendiente". H-003 persiste.
- 🔴 `/posicion-integral` — Total bruto USD **40.000,00** (sin cambios vs B3; nada tocó caja). CC neta USD **500,00** (sin cambios). Retiros pendientes USD **400,00** (antes 300; +100 por el nuevo Retiro IN de B4). Entregas pendientes USD **0,00** (el nuevo Pago OUT no entra acá). **Capital propio USD 40.100,00** = 40.000 + 500 − 400.
  - **Delta B3→B4 = −100 USD**, para una operación que es **compromiso a compromiso** (un derecho a cobrar 100 USD + una obligación de pagar 100 USD equiv.): patrimonio neto no debería variar → capital esperado seguía en 40.200 USD.
  - **Descomposición del −100 USD aparente:**
    - Bruto sin cambios ✅ (pendiente no toca caja).
    - Retiros pendientes sube +100 USD por el Retiro IN (H-004): el derecho a cobrar se contabiliza como si fuese un retiro del patrimonio ❌.
    - Entregas pendientes sin cambios (H-005): el Pago OUT (obligación real) queda huérfano, nunca entra al cálculo ❌.
    - Resultado: el derecho a cobrar resta, la obligación se ignora ⇒ el capital queda desbalanceado en **−100 USD** por la operación balanceada.
  - **Caso único de B4 — coexistencia simultánea de H-004 y H-005:** en la misma operación, el mismo monto de 100 USD equiv. se trata de forma **asimétrica**:
    - Un lado lo resta del capital aunque no debería (H-004, "Retiro").
    - El otro lado lo ignora aunque debería restar (H-005, "Pago").
    - Si la intención del usuario es "compromisos balanceados no mueven patrimonio", ambos bugs juntos deberían cancelarse — pero como actúan de forma opuesta sobre buckets distintos, no lo hacen, dejando un error neto de **−100 USD**.
  - **Contraste con A4 (mismo escenario pero cliente CC):** en A4 el capital daba 40.000 USD (Bruto 40.000 + CC 200 − Retiros 200), compensación *accidental* por H-001/H-002 inflando CC que masqueaba la asimetría H-004/H-005. En B4 (cliente sin CC) no hay ese enmascaramiento ⇒ se ve el error puro.
- ✅ `/cuentas` — sin cambios.
- ➖ `/caja-arqueos` — no aplica.

> **Cierre parcial B4:** con ambas patas pendientes y cliente sin CC, se confirma la **coexistencia simultánea y asimétrica** de H-004 + H-005 sobre la misma operación. No hay nuevo hallazgo, pero sí se evidencia por primera vez que los dos bugs son complementarios dentro de la misma transacción y no se auto-cancelan. Refuerza la necesidad de tratar ambos juntos en el mismo fix de `frontend/src/utils/pendingTypeLabels.ts` + `PosicionIntegralPage.tsx` líneas 378–383 y 466.

**B5 (cliente #1 SIN CC, IN USD Digital 100 / OUT ARS Digital 100.000, sin pendientes):**
- ✅ **Observación UX (confirma patrón conocido):** al poner **formato Digital en cualquiera de las dos patas** el checkbox "Pendiente" correspondiente queda **deshabilitado** (atributo `[disabled, readonly]` en el snapshot). Código responsable: `frontend/src/components/operations/CompraForm.tsx` — la lógica condicional del form oculta/deshabilita los checkboxes cuando `format === 'DIGITAL'`. Esto es **intencional y coherente** con la regla del usuario: "Digital impacta directo, no se puede dejar pendiente".
- ✅ `/posicion-caja` — **cambios correctos** en caja digital: ARS Digital 9.800.000 → **9.700.000** (−100.000 ARS por OUT), USD Digital 10.200 → **10.300** (+100 USD por IN). ARS Efectivo 9.500.000 y USD Efectivo 10.500 sin cambios. Balance-a-balance en el rail digital.
- ✅ `/posiciones` (Estado CC) — **sin cambios**: sólo cliente #4 con USD +500. Ratifica H-001 no aplica a cliente sin CC.
- ✅ `/pendientes` — **sin cambios** (8 Abiertos heredados). B5 no generó ningún pendiente (imposible por UX).
- ✅ `/inicio` — Utilidad/Gastos/Resultado 0,00 ARS.
- ✅ `/movimientos` — operación **#20** CONFIRMADA sin etiqueta "Pendiente" (correcto). H-003 persiste (saltos en numeración por borradores previos eliminados — no es bug nuevo).
- ✅ `/posicion-integral` — Total bruto USD **40.000,00** (20.000 físico + 20.000 digital; intercambio balanceado en USD equiv. no mueve el bruto). CC neta USD **500,00** (sin cambios). Retiros pendientes USD **400,00** (sin cambios). Entregas pendientes USD **0,00**. **Capital propio USD 40.100,00** = 40.000 + 500 − 400.
  - **Delta B4→B5 = 0 USD** ✅ **correcto**. Compra balanceada sin pendientes y sin CC ⇒ patrimonio no debe variar.
  - **Contraste con B1:** mismo patrón (cliente sin CC, sin pendientes, balanceada) en formato Efectivo/Efectivo daba también delta 0. B5 reproduce el mismo happy-path con Digital/Digital. Confirma que el "happy path" de Compra es independiente del formato cuando no hay pendientes ni CC.
- ✅ `/cuentas` — sin cambios (no tiene saldos propios).
- ➖ `/caja-arqueos` — no aplica.

> **Hallazgo positivo B5 (sin nueva advertencia):** primera confirmación de que la combinación **"cliente sin CC + sin pendientes + Digital"** también funciona correctamente (delta 0 al capital). Junto con B1, delimita el **happy-path de Compra**: cliente sin CC + sin pendientes ⇒ ningún bug conocido se activa, independientemente del formato (Efectivo o Digital). Los bugs H-001/H-002/H-004/H-005 requieren sí-o-sí que concurra CC habilitada (H-001/H-002) o algún pendiente (H-004/H-005).

**B6 (cliente #1 SIN CC, IN USD Efectivo 100 / OUT ARS Digital 100.000, sin pendientes — formato mixto):**
- ✅ **Observación UX:** con IN = Efectivo, "Pendiente de retiro" queda habilitado (`[readonly]`, sin marcar); con OUT = Digital, "Pendiente de pago" pasa a `[disabled, readonly]`. Comportamiento por línea (no global) coherente con A6/B3/B5. Código responsable: `frontend/src/components/operations/CompraForm.tsx`.
- ✅ `/posicion-caja` — USD Efectivo 10.500 → **10.600** (+100 por IN ef.), ARS Digital 9.700.000 → **9.600.000** (−100.000 por OUT dig.). USD Digital y ARS Efectivo sin cambios. Cada pata impacta su compartimento real (cross-formato y cross-divisa correcto).
- ✅ `/posiciones` (Estado CC) — **sin cambios**: sigue solo cliente #4 con USD +500. Cliente #1 (sin CC) no genera `cc_entries` ⇒ ratifica H-001 no aplica a `cc_enabled=false`.
- ✅ `/pendientes` — **sin cambios** (8 Abiertos heredados). B6 no generó ningún pendiente (IN no marcado, OUT imposible por UX al ser Digital).
- ✅ `/inicio` — Utilidad/Gastos/Resultado 0,00 ARS (compra aislada sin venta).
- ✅ `/movimientos` — operación **#21** CONFIRMADA, **sin** etiqueta "Pendiente" (correcto). H-003 persiste.
- ✅ `/posicion-integral` — Total bruto USD **40.000,00** (20.100 físico + 19.900 digital; intercambio balanceado en USD equiv. no mueve el bruto). CC neta USD **500,00** (sin cambios). Retiros pendientes USD **400,00** (sin cambios). Entregas pendientes USD **0,00**. **Capital propio USD 40.100,00** = 40.000 + 500 − 400.
  - **Delta B5→B6 = 0 USD** ✅ **correcto**. Compra balanceada (USD 100 IN ↔ ARS 100.000 OUT al TC 1.000) sin pendientes y sin CC ⇒ patrimonio invariante.
  - **Contraste B1 + B5 + B6:** los tres "happy paths" sin pendientes y sin CC, con todos los formatos posibles (Ef/Ef en B1, Dig/Dig en B5, Ef/Dig en B6) producen delta 0. Confirma que el bug H-001/H-002 está 100% atado a `cc_enabled=true` y el formato es irrelevante en escenarios sin pendientes.
- ✅ `/cuentas` — sin cambios (no tiene saldos propios).
- ➖ `/caja-arqueos` — no aplica.

> **Hallazgo positivo B6 (sin nueva advertencia):** segundo formato mixto del happy-path (Efectivo IN + Digital OUT) reproduce delta 0 exacto. La cobertura del happy-path queda completa para 3 de 4 combinaciones de formato (falta sólo B7: Dig/Ef). Reglas residuales que rigen el "happy path" de Compra: (i) `cc_enabled=false`, (ii) ningún checkbox de pendiente marcado o marcable. Cuando ambas se cumplen, ningún bug conocido se activa.

**B7 (cliente #1 SIN CC, IN USD Digital 100 / OUT ARS Efectivo 100.000, sin pendientes — formato mixto inverso):**
- ✅ **Observación UX:** con IN = Digital, "Pendiente de retiro" pasa a `[disabled, readonly]`; con OUT = Efectivo, "Pendiente de pago" queda habilitado (`[readonly]`, sin marcar). Comportamiento por línea **inverso a B6** y simétrico: cada checkbox depende exclusivamente del formato de su propia pata. Código responsable: `frontend/src/components/operations/CompraForm.tsx`.
- ✅ `/posicion-caja` — ARS Efectivo 9.500.000 → **9.400.000** (−100.000 por OUT ef.), USD Digital 10.300 → **10.400** (+100 por IN dig.). ARS Digital y USD Efectivo sin cambios. Cada pata impacta su compartimento (cross-formato y cross-divisa correcto, espejo de B6).
- ✅ `/posiciones` (Estado CC) — **sin cambios**: sólo cliente #4 con USD +500. Cliente #1 (sin CC) no genera `cc_entries` ⇒ ratifica H-001 no aplica.
- ✅ `/pendientes` — **sin cambios** (8 Abiertos heredados). B7 no generó pendientes (IN imposible por UX al ser Digital, OUT no marcado).
- ✅ `/inicio` — Utilidad/Gastos/Resultado 0,00 ARS.
- ✅ `/movimientos` — operación **#22** CONFIRMADA, **sin** etiqueta "Pendiente". H-003 persiste.
- ✅ `/posicion-integral` — Total bruto USD **40.000,00** (intercambio balanceado). CC neta USD **500,00** (sin cambios). Retiros pendientes USD **400,00** (sin cambios). Entregas pendientes USD **0,00**. **Capital propio USD 40.100,00** = 40.000 + 500 − 400.
  - **Delta B6→B7 = 0 USD** ✅ **correcto**. Compra balanceada (USD 100 IN ↔ ARS 100.000 OUT al TC 1.000), sin pendientes y sin CC ⇒ patrimonio invariante.
  - **Cobertura completa del happy-path:** B1 (Ef/Ef) + B5 (Dig/Dig) + B6 (Ef/Dig) + B7 (Dig/Ef) = 4 de 4 combinaciones de formato producen delta 0 al capital cuando el cliente no tiene CC y no hay pendientes. Confirma 100% que H-001/H-002 dependen de `cc_enabled=true` y H-004/H-005 de la presencia de pendientes — ningún bug se activa por formato per se.
- ✅ `/cuentas` — sin cambios.
- ➖ `/caja-arqueos` — no aplica.

> **Cierre de Fase B (B1..B7, cliente sin CC):** las 7 variantes testadas confirman:
> 1. **Happy-path completo** (B1, B5, B6, B7): cliente sin CC + sin pendientes ⇒ Compra es **transparente al patrimonio**, independientemente del formato. Capital invariante en los 4 casos.
> 2. **H-001/H-002 NO aplican** a clientes sin CC: el guard `if ccEnabled && !inPending` en `compra_service.go` línea 137 evita correctamente la entrada al `applyCCImpactTx`. Comportamiento contable correcto en este eje.
> 3. **H-004 (Retiro IN como obligación) y H-005 (Pago OUT huérfano)** SÍ aplican a clientes sin CC: B2 (−200 USD), B3 (+100 USD) y B4 (−100 USD) demuestran que los bugs de etiquetado de pendientes en `frontend/src/utils/pendingTypeLabels.ts` y filtrado en `PosicionIntegralPage.tsx` líneas 378–383 + 466 son **independientes** de `cc_enabled`. La causa raíz es taxonómica/UI, no comercial/CC.
> 4. **UX disabling de checkboxes "Pendiente"** funciona simétrica y por línea (no global): cada pata se rige sólo por su propio formato. Comportamiento intencional y consistente.
> 5. **Botón "Compensar"** en `/pendientes` aparece **sólo para clientes con CC**. Coherente con el alcance del feature (resolución contra saldo CC).
> 6. **`/inicio` Utilidad** se mantiene en 0 en todos los casos: la utilidad sólo se materializa al vender stock (FX inventory), no al comprar — comportamiento esperado.
> 7. **H-003 (gaps en numeración de operaciones)** persiste y crece: empezó con 8 huecos (#1, #2, #4, #6, #7, #8) y ahora tras 14 operaciones reales hay también borradores eliminados que generan saltos. Severidad sigue siendo 🟢 baja.

## Estado de cierre — Sprint Fix Compra (simetría CC + reclasificación pendientes)

> Aplicado en este sprint con alcance estricto a la operación **Compra** y la
> capa UI de pendientes (regla 13). Sin push a remoto hasta validación manual
> del usuario (smoke tests A1–A7 / B1–B7 sobre DB limpia).
>
> **Commit local:** `fix(compra): simetría CC + reclasificación pendientes
> (H-001..H-006)` (verificar con `git log -1 --format='%h %s'`).

| Hallazgo | Estado | Notas de cierre |
|---|---|---|
| H-001 — Asimetría CC en Compra | ✅ RESUELTO | Reescrito el bloque IN/OUT de `compra_service.go` con la Tabla maestra: la pata no-pendiente con CC ya no genera `cc_entries`; las pendientes con CC sí. **Atención:** la asignación de `ccSide` original se invirtió posteriormente (sprint H-015/H-016 — ver más abajo) por inconsistencia con la convención del sistema. |
| H-002 — Capital propio inflado por CC fantasma | ✅ RESUELTO | Consecuencia directa del cierre de H-001: al desaparecer el `cc_entries` espurio, la fórmula de capital propio deja de duplicar. |
| H-003 — Saltos en numeración de operaciones | 🟢 ABIERTO | Fuera del alcance del sprint. Decisión de diseño pendiente del usuario. |
| H-004 — "Retiro IN" de Compra restaba capital | ✅ RESUELTO | Etiquetas unificadas: "Pendiente de cobro" en Compra IN (suma) vs "Pendiente de pago" en Compra OUT (resta). Bucket "Por cobrar" en `/posicion-integral`. |
| H-005 — "Pago OUT" de Compra ignorado en capital | ✅ RESUELTO | Etiquetas unificadas + bucket "Por pagar" (resta del capital). El pendiente OUT de Compra ahora siempre entra al cálculo. |
| H-006 — Bucket "Retiros pendientes" mezclaba obligaciones y derechos | ✅ RESUELTO | Separación en dos buckets distintos ("Por cobrar" suma; "Por pagar" resta) basados en helpers `isPendingPorCobrar`/`isPendingPorPagar`. |

## Deuda técnica conocida (próximos sprints)

Las siguientes operaciones tienen el mismo patrón asimétrico que se corrigió en
Compra y deben aplicarse en sprints futuros respetando la regla 13 (alcance
estricto). Documentado y aceptado por el usuario (regla 16: riesgo residual
controlado).

- `backend/internal/services/venta_service.go` — ✅ **RESUELTO** en el sprint Fix Venta (`HALLAZGOS_AUDITORIA_VENTA.md`, H-007..H-010) y refinado en el sprint Fix Signo CC (H-013/H-014, ver sección abajo).
- `backend/internal/services/arbitraje_service.go` — verificar simetría CC.
- `backend/internal/services/transferencia_service.go` — ya simétrica, pero
  validar lógica CC vs sin-CC y eliminación de pendientes para CC.
- `backend/internal/services/ingreso_capital_service.go`,
  `retiro_capital_service.go`, `gasto_service.go`,
  `pago_cc_cruzado_service.go`, `traspaso_deuda_cc_service.go` — auditar el
  mismo patrón.

**Riesgo residual:** los flujos no migrados pueden presentar comportamientos
inconsistentes con Compra hasta que se aplique el mismo fix. Documentado y
aceptado por el usuario.

**Tipado estricto pendiente (frontend):** los helpers de
`frontend/src/utils/pendingTypeLabels.ts` mantienen firma `string` porque hoy
no existen los tipos compartidos `PendingType` / `MovementType` (verificación
A.5). Migrar a tipos literal-union queda como deuda técnica a abordar cuando
se introduzca un módulo de tipos en `frontend/src/types/pending.ts`.

## Próximos pasos de auditoría

| Caso | Cliente | IN | OUT | Estado |
|---|---|---|---|---|
| A1 | #4 CC | Efectivo 100 USD no pendiente | Efectivo 100.000 ARS no pendiente | ✅ hecho |
| A2 | #4 CC | Efectivo 100 USD **pendiente de retiro** | Efectivo 100.000 ARS no pendiente | ✅ hecho |
| A3 | #4 CC | Efectivo 100 USD no pendiente | Efectivo 100.000 ARS **pendiente de pago** | ✅ hecho |
| A4 | #4 CC | Efectivo 100 USD **pendiente** | Efectivo 100.000 ARS **pendiente** | ✅ hecho |
| A5 | #4 CC | Digital / Digital | — | ✅ hecho |
| A6 | #4 CC | Efectivo / Digital | — | ✅ hecho |
| A7 | #4 CC | Digital / Efectivo | — | ✅ hecho |
| B1 | #1 sin CC | Efectivo 100 USD no pendiente | Efectivo 100.000 ARS no pendiente | ✅ hecho |
| B2 | #1 sin CC | Efectivo 100 USD **pendiente de retiro** | Efectivo 100.000 ARS no pendiente | ✅ hecho |
| B3 | #1 sin CC | Efectivo 100 USD no pendiente | Efectivo 100.000 ARS **pendiente de pago** | ✅ hecho |
| B4 | #1 sin CC | Efectivo **pendiente** | Efectivo **pendiente** | ✅ hecho |
| B5 | #1 sin CC | Digital / Digital | — | ✅ hecho |
| B6 | #1 sin CC | Efectivo / Digital | — | ✅ hecho |
| B7 | #1 sin CC | Digital / Efectivo | — | ✅ hecho |

---

## Sprint Fix Signo CC pendientes Compra+Venta — H-013..H-016 — Sun Apr 26 2026

> Este sprint corrige un bug sistémico que se introdujo durante el sprint Fix Compra y se replicó en Fix Venta: las invocaciones de `applyCCImpactTx` para patas CC pendientes usaban el `ccSide` opuesto al que corresponde según la convención del sistema (`backend/internal/services/cc_service.go:37` y `backend/internal/repositories/cc_repo.go:56`: *"negative = client owes more, positive = debt reduction"*). Resultado visible: en `/posiciones`, el balance del cliente se movía en sentido opuesto al esperado (saldo a favor cuando debía ser deuda y viceversa).
>
> El bug pasó la review original porque los tests del helper `decideCompraLineEffect` / `decideVentaLineEffect` solo validaban *si* aplicar CC, no *con qué side*; los smokes runtime no asertaban el delta exacto contra un balance inicial conocido; y la "tabla maestra" original fijaba los sides al revés y se copió por inercia en cada sprint.

### Tabla maestra corregida (signos canónicos)

Convención del sistema (no negociable, citada en código):

- `+` en `cc_balances.balance` ⇒ **saldo a favor del cliente / la casa le debe al cliente**.
- `−` en `cc_balances.balance` ⇒ **deuda del cliente con la casa**.

Para clientes con CC y pata pendiente, los sides correctos son:

| Operación | Pata | Quién debe a quién | `ccSide` aplicado | Signo final | Hallazgo |
|---|---|---|---|---|---|
| **Compra** | IN pend. | El cliente nos debe entregar la divisa que vendió → cliente debe a la casa | `ccSideOut` | `−` | H-015 |
| **Compra** | OUT pend. | La casa debe pagarle la cotización al cliente → casa debe al cliente | `ccSideIn` | `+` | H-016 |
| **Venta** | OUT pend. | La casa debe entregar la divisa al cliente → casa debe al cliente | `ccSideIn` | `+` | H-013 |
| **Venta** | IN pend. | El cliente debe pagarnos → cliente debe a la casa | `ccSideOut` | `−` | H-014 |

Para clientes sin CC o patas no-pendientes, no cambia nada respecto al sprint anterior (la tabla maestra de presencia de `cc_entries` / `pending_items` por `(cc_enabled, pending)` sigue intacta).

### H-013 — Signo CC invertido en Venta OUT pendiente — ✅ RESUELTO

- **Archivo:** `backend/internal/services/venta_service.go:127`.
- **Antes:** `ccSideOut` (movía el balance del cliente en `−`, registrando una deuda inexistente).
- **Después:** `ccSideIn` (mueve el balance en `+`, "la casa le debe al cliente la divisa que todavía no entregó").
- **Detalles ampliados:** ver `HALLAZGOS_AUDITORIA_VENTA.md` (apéndice de reapertura).

### H-014 — Signo CC invertido en Venta IN pendiente — ✅ RESUELTO

- **Archivo:** `backend/internal/services/venta_service.go:149`.
- **Antes:** `ccSideIn` (registraba un saldo a favor del cliente cuando este nos debía).
- **Después:** `ccSideOut` (registra correctamente la deuda: "el cliente todavía no nos pagó").

### H-015 — Signo CC invertido en Compra IN pendiente — ✅ RESUELTO

- **Archivo:** `backend/internal/services/compra_service.go:133`.
- **Antes:** `ccSideIn` (registraba saldo a favor del cliente cuando este nos debía la divisa que vendió).
- **Después:** `ccSideOut` (deuda del cliente: "todavía no nos entregó la divisa").

### H-016 — Signo CC invertido en Compra OUT pendiente — ✅ RESUELTO

- **Archivo:** `backend/internal/services/compra_service.go:154`.
- **Antes:** `ccSideOut` (registraba deuda del cliente cuando la casa le debía pagar la cotización).
- **Después:** `ccSideIn` (la casa le debe al cliente la cotización que todavía no pagó).

### Tests añadidos / actualizados

- **Nuevo:** `backend/internal/services/cc_sign_invariant_test.go` — tres capas de defensa puras (sin DB):
  1. Convención del helper `signedCCAmount`.
  2. Tabla semántica operación→pata→side esperado para los 4 casos.
  3. Invariante estructural: lee `compra_service.go` y `venta_service.go` con `runtime.Caller` y verifica que las 4 invocaciones reales a `applyCCImpactTx` (ancladas por la nota textual del `cc_entry`) usan el side correcto.
- **Actualizados:** `compra_service_cc_test.go` y `venta_service_cc_test.go` — comentarios de cabecera y `WriteString` documentales con la convención corregida (los asserts del helper no cambian: el helper sigue decidiendo *si* aplicar CC, no *con qué side*).

### Pendientes de auditar (alcance fuera de este sprint, prioridad alta para próximo)

> **Auditoría de lectura (2026-04-27) —** Detalle, IDs **H-017..H-022** y referencias: **`HALLAZGOS_AUDITORIA_ARBITRAJE_TRANSFERENCIA.md`**. No reemplaza smokes; prioriza riesgo de alineación con la tabla maestra H-013..H-016 y con la política "CC + pendiente → sin `pending_items`" en módulos que aún no migraron.

Los siguientes servicios usan `ccSideIn` / `ccSideOut` y no fueron auditados en profundidad respecto a la convención de signo del sistema. Quedan como deuda técnica con prioridad alta porque podrían tener el mismo patrón de inversión (o no — la auditoría es lo que lo determinará):

- `backend/internal/services/arbitraje_service.go` — **H-017, H-018, H-019** en el doc vinculado. Resumen: sigue creando `pending_items` aun con CC; no aplica CC a la pata **costo (OUT)**; asimetría en `cc_apply_on_resolve` entre costo y cobrado.
- `backend/internal/services/transferencia_service.go` — **H-020, H-021** en el doc vinculado. Resumen: mapeo IN/OUT REAL 1:1 a `ccSide`; riesgo al contrastar con resolve CC diferida vs tabla de obligaciones (H-020); comisión con cobro `OWED_PENDING` sin CC de fee (H-021).
- `backend/internal/services/pending_service.go:237` — **H-022** en el doc vinculado. Resumen: CC diferida usa `MovementLineSide` como `ccSide` sin tabla por tipo de operación; coherente con "side literal" pero tensión potencial con H-013..H-016.

Servicios **revisados visualmente y considerados consistentes** con la convención (no se tocan en este sprint):

- `backend/internal/services/traspaso_deuda_cc_service.go` — comentario explícito *"To client debt increases => OUT (negative)"* y simetría from/to. ✓
- `backend/internal/services/ingreso_capital_service.go` y `retiro_capital_service.go` — sides explícitos coherentes con el flujo capital ↔ caja. ✓
- `backend/internal/services/pago_cc_cruzado_service.go:139-142` — calcula el side dinámicamente según el balance actual del cliente y respeta `cc_allow_overpay` / `cc_allow_positive_balance`. Probablemente correcto. ✓ (revisar a fondo en el sprint que audite Pago CC.)

### Riesgo residual

- **Para Compra y Venta CC pendientes: 0%.** Tabla maestra publicada, tres capas de defensa de tests, comentarios inline citando convención y hallazgo, smokes runtime S1–S4 ejecutados con balance inicial conocido y verificados contra la UI.
- **Para arbitraje, transferencia y pending_service.Resolve: abierto, prioridad alta.** Documentado en este apéndice, aceptado por el usuario, próximo sprint.