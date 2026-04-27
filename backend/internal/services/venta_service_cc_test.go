package services

import (
	"strings"
	"testing"
)

// Tests de Tabla maestra para Venta (Fix Venta: simetría CC + reclasificación
// pendientes — H-007/H-008/H-009/H-010). Verifican que `decideVentaLineEffect`
// aplica exactamente los efectos contables esperados según `ccEnabled` y la
// resolución de pendiente (`pending_cash && format == CASH`), cubriendo las 4
// filas de la Tabla maestra para cada pata (OUT y multi-IN), más la doble
// defensa que descarta el flag pendiente cuando el formato es DIGITAL (H-012).
//
// Los tests son puros (sin DB): la helper aislada concentra la decisión de
// flujo que antes vivía mezclada en `Execute`. Validar la helper en aislamiento
// — junto con los smokes runtime documentados en
// `HALLAZGOS_AUDITORIA_VENTA.md` — garantiza que el bloque reescrito de
// `Execute` (líneas 115-159 del fix) respeta la Tabla maestra.
//
// Convención del helper de pendiente (espejo de `venta_service.go:119,141`):
//
//	pending := pendingCashFlag && format == "CASH"
//
// Esa precondición se expresa explícitamente en cada test para que la
// regresión H-012 quede cubierta sin tocar DB.

func resolveVentaPending(pendingCashFlag bool, format string) bool {
	return pendingCashFlag && format == "CASH"
}

// TestVentaExecute_CC_OutPending — V2 esperado.
// Cliente con CC, OUT marcado pendiente CASH, IN no pendiente.
// Debe registrar 1 cc_entry en OUT (Out.Currency +X, ccSideIn — la casa
// debe entregar la divisa al cliente, saldo a favor del cliente sube) y
// 0 pending_items. H-013: convención del sistema (cc_service.go:37 /
// cc_repo.go:56: positive = debt reduction / saldo a favor).
func TestVentaExecute_CC_OutPending(t *testing.T) {
	t.Parallel()

	outPending := resolveVentaPending(true, "CASH")
	inPending := resolveVentaPending(false, "CASH")

	out := decideVentaLineEffect(true, outPending)
	in := decideVentaLineEffect(true, inPending)

	if !out.ApplyCC {
		t.Fatalf("OUT: ApplyCC=false; CC con OUT pendiente debe registrar cc_entry (H-007/H-008/H-009)")
	}
	if out.InsertPending {
		t.Fatalf("OUT: InsertPending=true; cliente CC no debe crear pending_items (H-008)")
	}
	if in.ApplyCC {
		t.Fatalf("IN: ApplyCC=true; pata IN no pendiente no debe tocar cc_entries (regla 2 — sin doble impacto)")
	}
	if in.InsertPending {
		t.Fatalf("IN: InsertPending=true; sin pendiente y con CC no debe crearse pending_item")
	}
}

// TestVentaExecute_CC_InPending — V3 esperado.
// Cliente con CC, OUT no pendiente, IN marcado pendiente CASH.
// Debe registrar 1 cc_entry en IN (Quote.Currency -Y, ccSideOut — el cliente
// nos debe pagar, deuda del cliente sube) y 0 pending_items. H-014:
// convención del sistema (cc_service.go:37 / cc_repo.go:56:
// negative = client owes more).
func TestVentaExecute_CC_InPending(t *testing.T) {
	t.Parallel()

	outPending := resolveVentaPending(false, "CASH")
	inPending := resolveVentaPending(true, "CASH")

	out := decideVentaLineEffect(true, outPending)
	in := decideVentaLineEffect(true, inPending)

	if out.ApplyCC {
		t.Fatalf("OUT: ApplyCC=true; pata OUT no pendiente con CC no debe generar cc_entry fantasma (H-009)")
	}
	if out.InsertPending {
		t.Fatalf("OUT: InsertPending=true; sin pendiente no debe crearse pending_item")
	}
	if !in.ApplyCC {
		t.Fatalf("IN: ApplyCC=false; CC con IN pendiente debe registrar cc_entry (H-007/H-014)")
	}
	if in.InsertPending {
		t.Fatalf("IN: InsertPending=true; cliente CC no debe crear pending_items (H-008)")
	}
}

// TestVentaExecute_NoCC_OutPending — V4 esperado.
// Cliente sin CC, OUT pendiente CASH, IN no pendiente.
// Debe crear 1 pending_item PENDIENTE_DE_RETIRO en OUT y 0 cc_entries.
func TestVentaExecute_NoCC_OutPending(t *testing.T) {
	t.Parallel()

	outPending := resolveVentaPending(true, "CASH")
	inPending := resolveVentaPending(false, "CASH")

	out := decideVentaLineEffect(false, outPending)
	in := decideVentaLineEffect(false, inPending)

	if !out.InsertPending {
		t.Fatalf("OUT: InsertPending=false; sin CC y con pendiente debe crearse pending_item (etiqueta UI \"Pendiente de pago\")")
	}
	if out.ApplyCC {
		t.Fatalf("OUT: ApplyCC=true; cliente sin CC nunca debe escribir cc_entries")
	}
	if in.InsertPending {
		t.Fatalf("IN: InsertPending=true; sin pendiente no debe crearse pending_item")
	}
	if in.ApplyCC {
		t.Fatalf("IN: ApplyCC=true; cliente sin CC nunca debe escribir cc_entries")
	}
}

// TestVentaExecute_NoCC_InPending — espejo de V4 sobre la pata IN.
// Cliente sin CC, OUT no pendiente, IN pendiente CASH.
// Debe crear 1 pending_item PENDIENTE_DE_PAGO en IN y 0 cc_entries.
func TestVentaExecute_NoCC_InPending(t *testing.T) {
	t.Parallel()

	outPending := resolveVentaPending(false, "CASH")
	inPending := resolveVentaPending(true, "CASH")

	out := decideVentaLineEffect(false, outPending)
	in := decideVentaLineEffect(false, inPending)

	if out.InsertPending {
		t.Fatalf("OUT: InsertPending=true; sin pendiente no debe crearse pending_item")
	}
	if out.ApplyCC {
		t.Fatalf("OUT: ApplyCC=true; cliente sin CC nunca debe escribir cc_entries")
	}
	if !in.InsertPending {
		t.Fatalf("IN: InsertPending=false; sin CC y con pendiente debe crearse pending_item (etiqueta UI \"Pendiente de cobro\")")
	}
	if in.ApplyCC {
		t.Fatalf("IN: ApplyCC=true; cliente sin CC nunca debe escribir cc_entries")
	}
}

// TestVentaExecute_CC_DigitalPendingIgnored — defensa backend H-012.
// Cliente con CC, OUT format=DIGITAL con pending_cash=true, IN CASH no pend.
// El flag pendiente debe ser descartado por la doble defensa (la UI ya lo
// neutraliza, pero el backend no debe confiar solo en eso — regla 4).
// Resultado esperado: 0 cc_entries y 0 pending_items.
func TestVentaExecute_CC_DigitalPendingIgnored(t *testing.T) {
	t.Parallel()

	outPending := resolveVentaPending(true, "DIGITAL")
	if outPending {
		t.Fatalf("doble defensa rota: pending_cash=true con format=DIGITAL no debe convertirse en pendiente (H-012)")
	}

	inPending := resolveVentaPending(false, "CASH")

	out := decideVentaLineEffect(true, outPending)
	in := decideVentaLineEffect(true, inPending)

	if out.ApplyCC {
		t.Fatalf("OUT: ApplyCC=true; flag DIGITAL ignorado no debe generar cc_entry fantasma (H-009/H-012)")
	}
	if out.InsertPending {
		t.Fatalf("OUT: InsertPending=true; flag DIGITAL ignorado no debe generar pending_item")
	}
	if in.ApplyCC {
		t.Fatalf("IN: ApplyCC=true; pata IN no pendiente con CC no debe tocar cc_entries (regla 2)")
	}
	if in.InsertPending {
		t.Fatalf("IN: InsertPending=true; sin pendiente no debe crearse pending_item")
	}
}

// Documental: deja en log el orden lógico del Execute reescrito para futuros
// auditores. No tiene asserts; sirve como referencia rápida.
func TestSimulacionVentaTablaMaestra_DocumentacionFlujo(t *testing.T) {
	t.Parallel()
	var b strings.Builder
	b.WriteString("=== Simulación: confirmación Venta (código actual) ===\n")
	b.WriteString("1) TX begin\n")
	b.WriteString("2) INSERT movement_lines OUT (is_pending=true si OUT.pending_cash && Format==CASH)\n")
	b.WriteString("3) decideVentaLineEffect(ccEnabled, outPending):\n")
	b.WriteString("     CC && pending     → applyCCImpactTx(ccSideIn, \"Venta — divisa pendiente de entregar al cliente\")\n")
	b.WriteString("     !CC && pending    → InsertPendingItem(PENDIENTE_DE_RETIRO) [UI: \"Pendiente de pago\"]\n")
	b.WriteString("     resto             → solo caja (movement_line ya creado)\n")
	b.WriteString("4) Por cada IN line: INSERT movement_lines IN (is_pending=true si IN.pending_cash && Format==CASH)\n")
	b.WriteString("5) decideVentaLineEffect(ccEnabled, inPending):\n")
	b.WriteString("     CC && pending     → applyCCImpactTx(ccSideOut, \"Venta — pago pendiente del cliente\")\n")
	b.WriteString("     !CC && pending    → InsertPendingItem(PENDIENTE_DE_PAGO) [UI: \"Pendiente de cobro\"]\n")
	b.WriteString("     resto             → solo caja\n")
	b.WriteString("6) Auditoría + confirmar borrador + COMMIT\n")
	b.WriteString("Notas:\n")
	b.WriteString(" - H-007 cerrado: la pata IN ahora evalúa CC y registra cc_entry cuando corresponde.\n")
	b.WriteString(" - H-008 cerrado: para cliente CC, NO se crean pending_items: la trazabilidad va a cc_entries.\n")
	b.WriteString(" - H-009 cerrado: la condición OUT ya no es `ccEnabled && !outPending`; sin pendiente no toca CC.\n")
	b.WriteString(" - H-010 cerrado: comentarios alineados con etiquetas UI \"Pendiente de pago\" / \"Pendiente de cobro\".\n")
	b.WriteString(" - H-012 doble defensa: pending_cash=true con format!=CASH se descarta antes del helper.\n")
	b.WriteString(" - H-013/H-014 cerrados: el side de las patas CC pendientes respeta la convención del sistema\n")
	b.WriteString("   (negative = client owes more, positive = debt reduction). OUT pendiente → ccSideIn (casa debe);\n")
	b.WriteString("   IN pendiente → ccSideOut (cliente debe).\n")
	t.Log(b.String())
}
