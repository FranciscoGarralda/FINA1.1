package http

import (
	"encoding/json"
	"errors"
	"net/http"

	"fina/internal/auth"
	"fina/internal/repositories"
	"fina/internal/services"
)

func traspasoDeudaCCHandler(svc *services.TraspasoDeudaCCService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 16384)

		movementID := r.PathValue("id")
		if movementID == "" {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "id requerido")
			return
		}

		var input services.TraspasoDeudaCCInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "Datos inválidos.")
			return
		}

		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
		err := svc.Execute(r.Context(), movementID, input, claims.UserID)
		if err != nil {
			handleTraspasoDeudaCCError(w, err)
			return
		}

		RespondJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}
}

func handleTraspasoDeudaCCError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, services.ErrToClientRequired):
		RespondError(w, http.StatusBadRequest, "TO_CLIENT_REQUIRED", "El cliente destino es obligatorio.")
	case errors.Is(err, services.ErrSameClientNotAllowed):
		RespondError(w, http.StatusBadRequest, "SAME_CLIENT_NOT_ALLOWED", "El cliente origen y destino no pueden coincidir.")
	case errors.Is(err, services.ErrClientsMustBeCC):
		RespondError(w, http.StatusBadRequest, "CLIENTS_MUST_BE_CC", "Ambos clientes deben estar activos y con cuenta corriente habilitada.")
	case errors.Is(err, services.ErrInvalidAmount):
		RespondError(w, http.StatusBadRequest, "INVALID_AMOUNT", "Monto inválido.")
	case errors.Is(err, repositories.ErrCurrencyNotEnabled):
		RespondError(w, http.StatusBadRequest, "INVALID_CURRENCY", "La divisa es inválida o está inactiva.")
	case errors.Is(err, services.ErrMovementNotFound):
		RespondError(w, http.StatusNotFound, "NOT_FOUND", "Movimiento no encontrado.")
	case errors.Is(err, services.ErrMovementTypeMismatch):
		RespondError(w, http.StatusBadRequest, "TYPE_MISMATCH", "El movimiento no es de tipo TRASPASO_DEUDA_CC.")
	default:
		handleOperationError(w, err)
	}
}
