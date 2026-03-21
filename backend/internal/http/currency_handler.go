package http

import (
	"encoding/json"
	"errors"
	"net/http"

	"fina/internal/auth"
	"fina/internal/repositories"
	"fina/internal/services"
)

func createCurrencyHandler(svc *services.CurrencyService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxUserBodySize)

		var input services.CurrencyInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "Datos inválidos.")
			return
		}

		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
		id, err := svc.Create(r.Context(), input, claims.UserID)
		if err != nil {
			handleCurrencyError(w, err)
			return
		}

		RespondJSON(w, http.StatusCreated, map[string]string{"id": id})
	}
}

func updateCurrencyHandler(svc *services.CurrencyService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxUserBodySize)

		id := r.PathValue("id")
		if id == "" {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "id requerido")
			return
		}

		var input services.CurrencyInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "Datos inválidos.")
			return
		}

		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
		if err := svc.Update(r.Context(), id, input, claims.UserID); err != nil {
			handleCurrencyError(w, err)
			return
		}

		RespondJSON(w, http.StatusOK, map[string]string{"status": "updated"})
	}
}

func handleCurrencyError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, services.ErrCurrencyCodeRequired):
		RespondError(w, http.StatusBadRequest, "VALIDATION", "El código es obligatorio.")
	case errors.Is(err, services.ErrCurrencyCodeInvalid):
		RespondError(w, http.StatusBadRequest, "VALIDATION", "El código debe estar en mayúsculas (2 a 6 caracteres).")
	case errors.Is(err, services.ErrCurrencyNameRequired):
		RespondError(w, http.StatusBadRequest, "VALIDATION", "El nombre es obligatorio.")
	case errors.Is(err, services.ErrCurrencyCodeDuplicate):
		RespondError(w, http.StatusConflict, "DUPLICATE", "Ya existe una divisa con ese código.")
	case errors.Is(err, repositories.ErrNotFound):
		RespondError(w, http.StatusNotFound, "NOT_FOUND", "Divisa no encontrada.")
	default:
		RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Error interno del servidor.")
	}
}
