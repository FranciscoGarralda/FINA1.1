package http

import (
	"encoding/json"
	"errors"
	"net/http"

	"fina/internal/auth"
	"fina/internal/services"
)

func pagoCCCruzadoHandler(svc *services.PagoCCCruzadoService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 16384)

		movementID := r.PathValue("id")
		if movementID == "" {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "id requerido")
			return
		}

		var input services.PagoCCCruzadoInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "Datos inválidos.")
			return
		}

		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
		err := svc.Execute(r.Context(), movementID, input, claims.UserID)
		if err != nil {
			handlePagoCCCruzadoError(w, err)
			return
		}

		RespondJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}
}

func handlePagoCCCruzadoError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, services.ErrInvalidAmount):
		RespondError(w, http.StatusBadRequest, "INVALID_AMOUNT", "Monto inválido.")
	case errors.Is(err, services.ErrMovementNotFound):
		RespondError(w, http.StatusNotFound, "NOT_FOUND", "Movimiento no encontrado.")
	case errors.Is(err, services.ErrMovementTypeMismatch):
		RespondError(w, http.StatusBadRequest, "TYPE_MISMATCH", "El movimiento no es de tipo PAGO_CC_CRUZADO.")
	case errors.Is(err, services.ErrClientCCNotEnabled):
		RespondError(w, http.StatusBadRequest, "CLIENT_CC_NOT_ENABLED", "El cliente no tiene cuenta corriente habilitada.")
	case errors.Is(err, services.ErrAmountsMustMatch):
		RespondError(w, http.StatusBadRequest, "AMOUNTS_MUST_MATCH", "Los montos deben coincidir cuando la divisa es la misma.")
	case errors.Is(err, services.ErrInvalidPagoCCMode):
		RespondError(w, http.StatusBadRequest, "INVALID_PAGO_CC_MODE", "Modo inválido. Debe ser ENTRA o SALE.")
	case errors.Is(err, services.ErrCCBalanceZeroNotCancellable):
		RespondError(w, http.StatusBadRequest, "CC_BALANCE_ZERO_NOT_CANCELLABLE", "No hay saldo de CC en esta divisa para cancelar.")
	case errors.Is(err, services.ErrCCOverpayNotAllowed):
		RespondError(w, http.StatusBadRequest, "CC_OVERPAY_NOT_ALLOWED", "La política actual no permite sobre-cancelación.")
	case errors.Is(err, services.ErrCCPositiveBalanceNotAllowed):
		RespondError(w, http.StatusBadRequest, "CC_POSITIVE_BALANCE_NOT_ALLOWED", "La política actual no permite saldo positivo final.")
	default:
		handleOperationError(w, err)
	}
}
