package services

import (
	"strings"
	"testing"
)

// Simulación documental (sin DB): describe el orden lógico actual cuando se confirma
// una transferencia bilateral con CC habilitada. Ejecutar:
//
//	go test ./internal/services -run=SimulacionTransferenciaCC -v
//
// Sirve para alinear producto/desarrollo con docs/prompts/BORRADOR-transferencia-cc-caja-pendiente.txt
func TestSimulacionTransferenciaCC_DocumentacionFlujoBilateral(t *testing.T) {
	t.Parallel()
	var b strings.Builder
	b.WriteString("=== Simulación: confirmación transferencia bilateral (código actual) ===\n")
	b.WriteString("1) TX begin\n")
	b.WriteString("2) INSERT movement_lines OUT (is_pending=true si liquidación salida = PENDIENTE)\n")
	b.WriteString("3) Si salida pendiente → INSERT pending_items (PENDIENTE_DE_PAGO)\n")
	b.WriteString("4) INSERT movement_lines IN (is_pending=true si liquidación entrada = PENDIENTE)\n")
	b.WriteString("5) Si entrada pendiente → INSERT pending_items (PENDIENTE_DE_RETIRO)\n")
	b.WriteString("6) Si cliente.cc_enabled:\n")
	b.WriteString("     applyCCImpactTx → nota \"Transferencia — salida\" (SIEMPRE)\n")
	b.WriteString("     applyCCImpactTx → nota \"Transferencia — entrada\" (SIEMPRE)\n")
	b.WriteString("   → Aquí aparecen en UI los dos movimientos CC aunque 2–5 hayan sido pendiente.\n")
	b.WriteString("7) Comisión (si aplica): líneas + applyCCImpactTx \"Transferencia — comisión\"\n")
	b.WriteString("8) Auditoría + confirmar borrador + COMMIT\n")
	b.WriteString("Referencia: transferencia_service.go bloque ~545–575; cc_impact.go applyCCImpactTx.\n")
	t.Log(b.String())
}
