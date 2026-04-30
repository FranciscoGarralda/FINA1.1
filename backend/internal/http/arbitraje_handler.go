package http

import (
	"encoding/json"
	"errors"
	"net/http"

	"fina/internal/auth"
	"fina/internal/services"
)

func arbitrajeHandler(svc *services.ArbitrajeService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 16384)

		movementID := r.PathValue("id")
		if movementID == "" {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "id requerido")
			return
		}

		var input services.ArbitrajeInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "Datos inválidos.")
			return
		}

		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
		err := svc.Execute(r.Context(), movementID, input, claims.UserID)
		if err != nil {
			handleArbitrajeError(w, err)
			return
		}

		RespondJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}
}

func handleArbitrajeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, services.ErrInvalidAmount):
		RespondError(w, http.StatusBadRequest, "INVALID_AMOUNT", "Monto inválido.")
	case errors.Is(err, services.ErrProfitRequired):
		RespondError(w, http.StatusBadRequest, "PROFIT_REQUIRED", "El monto de ganancia es obligatorio.")
	case errors.Is(err, services.ErrProfitAccount):
		RespondError(w, http.StatusBadRequest, "PROFIT_ACCOUNT_REQUIRED", "Cuenta y divisa de ganancia son obligatorias.")
	case errors.Is(err, services.ErrMovementNotFound):
		RespondError(w, http.StatusNotFound, "NOT_FOUND", "Movimiento no encontrado.")
	case errors.Is(err, services.ErrMovementTypeMismatch):
		RespondError(w, http.StatusBadRequest, "TYPE_MISMATCH", "El movimiento no es de tipo ARBITRAJE.")
	case errors.Is(err, services.ErrArbitrajeClientsRequired):
		RespondError(w, http.StatusBadRequest, "ARBITRAJE_CLIENTS_REQUIRED", "Indicá cliente costo y cliente cobrado en la cabecera del borrador.")
	default:
		handleOperationError(w, err)
	}
}
