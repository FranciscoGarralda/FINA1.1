package http

import (
	"encoding/json"
	"errors"
	"net/http"

	"fina/internal/auth"
	"fina/internal/models"
	"fina/internal/repositories"
	"fina/internal/services"
)

func createAccountHandler(svc *services.AccountService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxUserBodySize)

		var input services.AccountInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "Datos inválidos.")
			return
		}

		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
		id, err := svc.Create(r.Context(), input, claims.UserID)
		if err != nil {
			handleAccountError(w, err)
			return
		}

		RespondJSON(w, http.StatusCreated, map[string]string{"id": id})
	}
}

func updateAccountHandler(svc *services.AccountService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxUserBodySize)

		id := r.PathValue("id")
		if id == "" {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "id requerido")
			return
		}

		var input services.AccountInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "Datos inválidos.")
			return
		}

		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
		if err := svc.Update(r.Context(), id, input, claims.UserID); err != nil {
			handleAccountError(w, err)
			return
		}

		RespondJSON(w, http.StatusOK, map[string]string{"status": "updated"})
	}
}

func getAccountCurrenciesHandler(svc *services.AccountService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if id == "" {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "id requerido")
			return
		}

		items, err := svc.GetAccountCurrencies(r.Context(), id)
		if err != nil {
			handleAccountError(w, err)
			return
		}
		if items == nil {
			items = []models.AccountCurrencyItem{}
		}

		RespondJSON(w, http.StatusOK, items)
	}
}

func updateAccountCurrenciesHandler(svc *services.AccountService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 8192)

		id := r.PathValue("id")
		if id == "" {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "id requerido")
			return
		}

		var items []repositories.AccountCurrencyInput
		if err := json.NewDecoder(r.Body).Decode(&items); err != nil {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "Datos inválidos.")
			return
		}

		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
		if err := svc.UpdateAccountCurrencies(r.Context(), id, items, claims.UserID); err != nil {
			handleAccountError(w, err)
			return
		}

		RespondJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

func handleAccountError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, services.ErrAccountNameRequired):
		RespondError(w, http.StatusBadRequest, "VALIDATION", "El nombre de la cuenta es obligatorio.")
	case errors.Is(err, services.ErrAccountFormatRequired):
		RespondError(w, http.StatusBadRequest, "VALIDATION", "Debe habilitar Efectivo o Digital para cada divisa habilitada.")
	case errors.Is(err, repositories.ErrNotFound):
		RespondError(w, http.StatusNotFound, "NOT_FOUND", "Cuenta no encontrada.")
	default:
		RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Error interno del servidor.")
	}
}
