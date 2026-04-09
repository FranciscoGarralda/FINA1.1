package http

import (
	"encoding/json"
	"errors"
	"net/http"

	"fina/internal/auth"
	"fina/internal/repositories"
	"fina/internal/services"
)

const maxCashArqueoBodySize = 256 * 1024

func listCashArqueosHandler(svc *services.CashArqueoService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		accountID := r.URL.Query().Get("account_id")
		from := r.URL.Query().Get("from")
		to := r.URL.Query().Get("to")
		items, err := svc.List(r.Context(), accountID, from, to)
		if err != nil {
			RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Error al listar arqueos.")
			return
		}
		if items == nil {
			items = []services.CashArqueoSummary{}
		}
		RespondJSON(w, http.StatusOK, map[string]interface{}{"arqueos": items})
	}
}

func cashArqueoSystemTotalsHandler(svc *services.CashArqueoService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		accountID := r.URL.Query().Get("account_id")
		asOf := r.URL.Query().Get("as_of")
		totals, err := svc.SystemTotalsForAccount(r.Context(), accountID, asOf)
		if err != nil {
			if errors.Is(err, services.ErrCashArqueoInvalidInput) {
				RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "account_id requerido.")
				return
			}
			if errors.Is(err, services.ErrCashArqueoAccountMissing) {
				RespondError(w, http.StatusNotFound, "NOT_FOUND", "Cuenta no encontrada.")
				return
			}
			RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Error al calcular saldos.")
			return
		}
		if totals == nil {
			totals = []repositories.AccountCurrencyFormatTotal{}
		}
		RespondJSON(w, http.StatusOK, map[string]interface{}{"totals": totals})
	}
}

func createCashArqueoHandler(svc *services.CashArqueoService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxCashArqueoBodySize)
		var input services.CashArqueoCreateInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "JSON inválido.")
			return
		}
		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
		out, err := svc.Create(r.Context(), input, claims.UserID)
		if err != nil {
			switch {
			case errors.Is(err, services.ErrCashArqueoInvalidInput):
				RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "Datos inválidos o fecha incorrecta.")
			case errors.Is(err, services.ErrCashArqueoNoLines):
				RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "Agregá al menos una divisa con conteo.")
			case errors.Is(err, services.ErrCashArqueoDupLine):
				RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "Misma divisa y formato repetidos en el arqueo.")
			case errors.Is(err, services.ErrCashArqueoBadFormat):
				RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "Formato inválido: usá CASH o DIGITAL.")
			case errors.Is(err, services.ErrCashArqueoFormatNotAllowed):
				RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "Ese formato no está habilitado para la divisa en la cuenta.")
			case errors.Is(err, services.ErrCashArqueoBadCurrency):
				RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "Divisa no asignada a la cuenta.")
			case errors.Is(err, services.ErrCashArqueoAccountMissing):
				RespondError(w, http.StatusNotFound, "NOT_FOUND", "Cuenta no encontrada.")
			default:
				RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Error al registrar arqueo.")
			}
			return
		}
		RespondJSON(w, http.StatusCreated, out)
	}
}
