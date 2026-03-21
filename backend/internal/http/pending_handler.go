package http

import (
	"encoding/json"
	"errors"
	"net/http"

	"fina/internal/auth"
	"fina/internal/repositories"
	"fina/internal/services"
)

func listPendingHandler(svc *services.PendingService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		items, err := svc.List(r.Context())
		if err != nil {
			RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Error al obtener pendientes.")
			return
		}
		if items == nil {
			items = []repositories.PendingListItem{}
		}
		RespondJSON(w, http.StatusOK, items)
	}
}

func resolvePendingHandler(svc *services.PendingService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 4096)

		id := r.PathValue("id")
		if id == "" {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "id requerido")
			return
		}

		var input services.ResolveInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "Datos inválidos.")
			return
		}

		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
		err := svc.Resolve(r.Context(), id, input, claims.UserID)
		if err != nil {
			handlePendingError(w, err)
			return
		}

		RespondJSON(w, http.StatusOK, map[string]string{"status": "resolved"})
	}
}

func cancelPendingHandler(svc *services.PendingService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if id == "" {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "id requerido")
			return
		}

		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
		err := svc.Cancel(r.Context(), id, claims.UserID)
		if err != nil {
			handlePendingError(w, err)
			return
		}

		RespondJSON(w, http.StatusOK, map[string]string{"status": "cancelled"})
	}
}

func handlePendingError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, services.ErrPendingAlreadyResolved):
		RespondError(w, http.StatusConflict, "ALREADY_RESOLVED", "Este pendiente ya fue resuelto.")
	case errors.Is(err, services.ErrInvalidResolveAmount):
		RespondError(w, http.StatusBadRequest, "INVALID_AMOUNT", "Monto inválido.")
	case errors.Is(err, services.ErrPartialNotAllowed):
		RespondError(w, http.StatusBadRequest, "PARTIAL_NOT_ALLOWED", "La resolución parcial no está habilitada.")
	case errors.Is(err, services.ErrInvalidResolveMode):
		RespondError(w, http.StatusBadRequest, "INVALID_RESOLVE_MODE", "Modo de resolución inválido.")
	case errors.Is(err, services.ErrCompensationOnlyForCC):
		RespondError(w, http.StatusBadRequest, "COMPENSATION_ONLY_FOR_CC", "Compensar solo está disponible para clientes con CC activa.")
	case errors.Is(err, services.ErrCompensatedRequiresRef):
		RespondError(w, http.StatusBadRequest, "COMPENSATED_REQUIRES_MOVEMENT_ID", "Compensar requiere referencia de operación.")
	case errors.Is(err, services.ErrCompensatedPartialNotAllowed):
		RespondError(w, http.StatusBadRequest, "COMPENSATED_PARTIAL_NOT_ALLOWED", "Compensar requiere el monto total pendiente.")
	case errors.Is(err, repositories.ErrCurrencyNotEnabled):
		RespondError(w, http.StatusBadRequest, "CURRENCY_NOT_ENABLED", "La cuenta no tiene habilitada la divisa seleccionada.")
	case errors.Is(err, repositories.ErrFormatNotAllowed):
		RespondError(w, http.StatusBadRequest, "FORMAT_NOT_ALLOWED", "El formato no está habilitado para esa cuenta/divisa.")
	case errors.Is(err, repositories.ErrNotFound):
		RespondError(w, http.StatusNotFound, "NOT_FOUND", "Pendiente no encontrado.")
	default:
		RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Error interno del servidor.")
	}
}
