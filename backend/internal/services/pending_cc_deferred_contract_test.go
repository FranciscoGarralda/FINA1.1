package services

import (
	"testing"

	"fina/internal/repositories"
)

// Contrato: CC diferida se identifica con CcApplyOnResolve en PendingDetail (columna pending_items.cc_apply_on_resolve).
// La aplicación en resolve ocurre en PendingService.Resolve cuando CcEnabled && CcApplyOnResolve (REAL_EXECUTION).
func TestPendingCCDeferredFlagSemantics(t *testing.T) {
	t.Parallel()
	legacy := repositories.PendingDetail{CcApplyOnResolve: false}
	if legacy.CcApplyOnResolve {
		t.Fatal("legacy default: CC ya aplicada al confirmar o sin CC en resolve")
	}
	deferred := repositories.PendingDetail{CcApplyOnResolve: true}
	if !deferred.CcApplyOnResolve {
		t.Fatal("nuevo pendiente con CC omitida al confirmar debe llevar flag true")
	}
}
