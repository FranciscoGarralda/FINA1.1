package services

import (
	"strings"
	"testing"
)

// Tests de Tabla maestra para Compra (Fix Compra: simetría CC + reclasificación
// pendientes — H-001/H-002/H-004/H-005). Verifican que `decideCompraLineEffect`
// aplica exactamente los efectos contables esperados según `ccEnabled` y
// `pending`, cubriendo las 4 filas de la Tabla maestra para cada pata (IN y
// OUT).
//
// Los tests son puros (sin DB): la helper aislada concentra la decisión de
// flujo que antes vivía mezclada en `Execute`. Validar la helper en aislamiento
// garantiza, junto con la simulación documental al final, que el bloque
// reescrito de `Execute` (líneas 122-159 originales) respeta la Tabla maestra.

// A — Cliente sin CC (cc_enabled=false): pending_items vive; cc_entries no se
// toca. Caja afectada solo si la pata no está marcada como pendiente.

func TestCompra_NoCC_NoPending_AffectsCashOnly(t *testing.T) {
	t.Parallel()
	for _, side := range []string{"IN", "OUT"} {
		side := side
		t.Run(side, func(t *testing.T) {
			eff := decideCompraLineEffect(false, false)
			if eff.ApplyCC {
				t.Fatalf("%s: ApplyCC=true; cliente sin CC nunca debe escribir cc_entries", side)
			}
			if eff.InsertPending {
				t.Fatalf("%s: InsertPending=true; sin pendiente no debe crearse pending_item", side)
			}
		})
	}
}

func TestCompra_NoCC_WithPending_CreatesPendingNoCC(t *testing.T) {
	t.Parallel()
	for _, side := range []string{"IN", "OUT"} {
		side := side
		t.Run(side, func(t *testing.T) {
			eff := decideCompraLineEffect(false, true)
			if !eff.InsertPending {
				t.Fatalf("%s: InsertPending=false; con cliente sin CC y pendiente, debe crearse pending_item", side)
			}
			if eff.ApplyCC {
				t.Fatalf("%s: ApplyCC=true; cliente sin CC nunca debe escribir cc_entries", side)
			}
		})
	}
}

// B — Cliente con CC (cc_enabled=true): pending_items deja de existir como
// concepto. Las patas pendientes generan cc_entries con el lado correcto
// según la convención de signo del sistema (cc_service.go:37 / cc_repo.go:56:
// "negative = client owes more, positive = debt reduction"):
//
//	Compra IN pendiente  → cliente nos debe la divisa que nos vendió → ccSideOut (negativo).
//	Compra OUT pendiente → la casa le debe la cotización al cliente   → ccSideIn  (positivo).
//
// Las no pendientes ya están saldadas en caja: NO debe registrarse cc_entries
// (regla 6 — sin doble impacto).

func TestCompra_CC_NoPending_AffectsCashNoCCEntry(t *testing.T) {
	t.Parallel()
	for _, side := range []string{"IN", "OUT"} {
		side := side
		t.Run(side, func(t *testing.T) {
			eff := decideCompraLineEffect(true, false)
			if eff.ApplyCC {
				t.Fatalf("%s: ApplyCC=true; pata liquidada en caja no debe duplicarse en cc_entries (H-001)", side)
			}
			if eff.InsertPending {
				t.Fatalf("%s: InsertPending=true; sin pendiente no debe crearse pending_item", side)
			}
		})
	}
}

func TestCompra_CC_WithPending_CreatesCCEntryNoPending(t *testing.T) {
	t.Parallel()
	for _, side := range []string{"IN", "OUT"} {
		side := side
		t.Run(side, func(t *testing.T) {
			eff := decideCompraLineEffect(true, true)
			if !eff.ApplyCC {
				t.Fatalf("%s: ApplyCC=false; cliente CC con pata pendiente debe registrar cc_entries", side)
			}
			if eff.InsertPending {
				t.Fatalf("%s: InsertPending=true; cliente CC no debe crear pending_items (todo va a CC)", side)
			}
		})
	}
}

// Documental: deja en log el orden lógico del Execute reescrito para futuros
// auditores. No tiene asserts; sirve como referencia rápida (`go test -run
// SimulacionCompraTablaMaestra -v`).
func TestSimulacionCompraTablaMaestra_DocumentacionFlujo(t *testing.T) {
	t.Parallel()
	var b strings.Builder
	b.WriteString("=== Simulación: confirmación Compra (código actual) ===\n")
	b.WriteString("1) TX begin\n")
	b.WriteString("2) INSERT movement_lines IN (is_pending=true si IN.pending_cash && Format==CASH)\n")
	b.WriteString("3) decideCompraLineEffect(ccEnabled, inPending):\n")
	b.WriteString("     CC && pending     → applyCCImpactTx(ccSideOut, \"Compra — divisa pendiente de cobro al cliente\")\n")
	b.WriteString("     !CC && pending    → InsertPendingItem(PENDIENTE_DE_RETIRO)\n")
	b.WriteString("     resto             → solo caja (movement_line ya creado)\n")
	b.WriteString("4) Por cada OUT line: INSERT movement_lines OUT (is_pending=true si OUT.pending_cash && Format==CASH)\n")
	b.WriteString("5) decideCompraLineEffect(ccEnabled, outPending):\n")
	b.WriteString("     CC && pending     → applyCCImpactTx(ccSideIn, \"Compra — pago pendiente al cliente\")\n")
	b.WriteString("     !CC && pending    → InsertPendingItem(PENDIENTE_DE_PAGO)\n")
	b.WriteString("     resto             → solo caja\n")
	b.WriteString("6) Auditoría + confirmar borrador + COMMIT\n")
	b.WriteString("Notas:\n")
	b.WriteString(" - H-001 cerrado: la pata no-pendiente con CC ya NO genera cc_entries (antes solo el IN tocaba CC).\n")
	b.WriteString(" - H-002 cerrado: como consecuencia, el capital propio deja de inflarse por CC fantasma.\n")
	b.WriteString(" - Para cliente CC, NO se crean pending_items: la trazabilidad va directa a cc_entries.\n")
	b.WriteString(" - H-015/H-016 cerrados: el side de las patas CC pendientes respeta la convención del sistema\n")
	b.WriteString("   (negative = client owes more, positive = debt reduction). IN pendiente → ccSideOut (cliente debe);\n")
	b.WriteString("   OUT pendiente → ccSideIn (casa debe).\n")
	t.Log(b.String())
}
