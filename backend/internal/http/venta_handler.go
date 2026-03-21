package http

import (
	"encoding/json"
	"errors"
	"net/http"

	"fina/internal/auth"
	"fina/internal/services"
)

func ventaHandler(svc *services.VentaService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 16384)

		movementID := r.PathValue("id")
		if movementID == "" {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "id requerido")
			return
		}

		var input services.VentaInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "Datos inválidos.")
			return
		}

		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
		err := svc.Execute(r.Context(), movementID, input, claims.UserID)
		if err != nil {
			handleVentaError(w, err)
			return
		}

		RespondJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}
}

func handleVentaError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, services.ErrCuadreNotMatch):
		RespondError(w, http.StatusBadRequest, "CUADRE_NOT_MATCH", "El total de entradas no coincide con el equivalente.")
	case errors.Is(err, services.ErrInvalidAmount):
		RespondError(w, http.StatusBadRequest, "INVALID_AMOUNT", "Monto inválido.")
	case errors.Is(err, services.ErrInvalidQuoteMode):
		RespondError(w, http.StatusBadRequest, "INVALID_QUOTE_MODE", "Modo de cotización inválido.")
	case errors.Is(err, services.ErrNoInLines):
		RespondError(w, http.StatusBadRequest, "NO_IN_LINES", "Se requiere al menos una línea de entrada.")
	case errors.Is(err, services.ErrMovementNotFound):
		RespondError(w, http.StatusNotFound, "NOT_FOUND", "Movimiento no encontrado.")
	case errors.Is(err, services.ErrMovementTypeMismatch):
		RespondError(w, http.StatusBadRequest, "TYPE_MISMATCH", "El movimiento no es de tipo VENTA.")
	default:
		handleOperationError(w, err)
	}
}
