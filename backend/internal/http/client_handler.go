package http

import (
	"encoding/json"
	"errors"
	"net/http"

	"fina/internal/auth"
	"fina/internal/repositories"
	"fina/internal/services"
)

func getClientHandler(svc *services.ClientService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if id == "" {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "id requerido")
			return
		}

		client, err := svc.GetByID(r.Context(), id)
		if err != nil {
			handleClientError(w, err)
			return
		}

		RespondJSON(w, http.StatusOK, client)
	}
}

func createClientHandler(svc *services.ClientService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 64*1024)

		var input repositories.ClientInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "Datos inválidos.")
			return
		}

		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
		id, err := svc.Create(r.Context(), input, claims.UserID)
		if err != nil {
			handleClientError(w, err)
			return
		}

		RespondJSON(w, http.StatusCreated, map[string]string{"id": id})
	}
}

func updateClientHandler(svc *services.ClientService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 64*1024)

		id := r.PathValue("id")
		if id == "" {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "id requerido")
			return
		}

		var input repositories.ClientInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "Datos inválidos.")
			return
		}

		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
		if err := svc.Update(r.Context(), id, input, claims.UserID); err != nil {
			handleClientError(w, err)
			return
		}

		RespondJSON(w, http.StatusOK, map[string]string{"status": "updated"})
	}
}

func handleClientError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, services.ErrClientFieldsRequired):
		RespondError(w, http.StatusBadRequest, "VALIDATION", "Todos los campos son obligatorios.")
	case errors.Is(err, services.ErrClientCCAdjustmentsRequireCC):
		RespondError(w, http.StatusBadRequest, "CC_ADJUSTMENTS_REQUIRE_CC", "No se pueden cargar saldos/ajustes de CC si CC no está habilitada.")
	case errors.Is(err, services.ErrClientCCDuplicateCurrency):
		RespondError(w, http.StatusBadRequest, "CC_DUPLICATE_CURRENCY", "No se permite repetir la misma divisa en ajustes de CC.")
	case errors.Is(err, services.ErrClientCCAdjustmentAmountInvalid), errors.Is(err, repositories.ErrInvalidCCAdjustmentAmount):
		RespondError(w, http.StatusBadRequest, "CC_ADJUSTMENT_INVALID_AMOUNT", "Monto de ajuste de CC inválido.")
	case errors.Is(err, repositories.ErrCurrencyNotEnabled):
		RespondError(w, http.StatusBadRequest, "CURRENCY_NOT_ENABLED", "La divisa indicada no está activa.")
	case errors.Is(err, repositories.ErrNotFound):
		RespondError(w, http.StatusNotFound, "NOT_FOUND", "Cliente no encontrado.")
	default:
		RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Error interno del servidor.")
	}
}
