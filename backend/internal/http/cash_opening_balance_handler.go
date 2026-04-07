package http

import (
	"encoding/json"
	"errors"
	"net/http"

	"fina/internal/auth"
	"fina/internal/repositories"
	"fina/internal/services"
)

func createCashOpeningBalanceHandler(svc *services.CashOpeningBalanceService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 262144)
		var input services.CashOpeningBalanceInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "Datos inválidos.")
			return
		}
		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
		res, err := svc.Create(r.Context(), input, claims.UserID)
		if err != nil {
			handleCashOpeningBalanceError(w, err)
			return
		}
		RespondJSON(w, http.StatusCreated, res)
	}
}

func handleCashOpeningBalanceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, services.ErrOpeningBalanceNoLines):
		RespondError(w, http.StatusBadRequest, "LINES_REQUIRED", "Indicá al menos una línea de saldo.")
	case errors.Is(err, services.ErrDuplicateOpeningBalanceLine):
		RespondError(w, http.StatusBadRequest, "DUPLICATE_LINE", "Hay líneas duplicadas (misma cuenta, divisa y formato).")
	case errors.Is(err, services.ErrOpeningBalanceTooManyLines):
		RespondError(w, http.StatusBadRequest, "TOO_MANY_LINES", "Demasiadas líneas en un solo movimiento.")
	case errors.Is(err, services.ErrCashOpeningBalanceDate):
		RespondError(w, http.StatusBadRequest, "INVALID_DATE", "Fecha inválida.")
	case errors.Is(err, services.ErrInvalidAmount):
		RespondError(w, http.StatusBadRequest, "INVALID_AMOUNT", "Monto o formato inválido.")
	case errors.Is(err, repositories.ErrCurrencyNotEnabled):
		RespondError(w, http.StatusBadRequest, "CURRENCY_NOT_ENABLED", "La cuenta no tiene habilitada la divisa seleccionada.")
	case errors.Is(err, repositories.ErrFormatNotAllowed):
		RespondError(w, http.StatusBadRequest, "FORMAT_NOT_ALLOWED", "El formato no está habilitado para esa cuenta/divisa.")
	case errors.Is(err, repositories.ErrNotFound):
		RespondError(w, http.StatusNotFound, "NOT_FOUND", "Recurso no encontrado.")
	default:
		RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Error interno del servidor.")
	}
}
