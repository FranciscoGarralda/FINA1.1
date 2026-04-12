package services

import (
	"errors"
	"testing"
)

func TestErrIfPendienteInicialBlocksCorrection(t *testing.T) {
	if err := errIfPendienteInicialBlocksCorrection("COMPRA"); err != nil {
		t.Fatalf("COMPRA: %v", err)
	}
	if err := errIfPendienteInicialBlocksCorrection(MovementTypePendienteInicial); !errors.Is(err, ErrPendienteInicialCorrectionNotAllowed) {
		t.Fatalf("PENDIENTE_INICIAL: got %v want ErrPendienteInicialCorrectionNotAllowed", err)
	}
}
