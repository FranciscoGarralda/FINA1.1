package http

import (
	"encoding/json"
	"net/http"

	"fina/internal/auth"
	"fina/internal/repositories"
)

func listFXQuotesHandler(repo *repositories.FXQuoteRepo) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		quotes, err := repo.List(r.Context())
		if err != nil {
			RespondError(w, http.StatusInternalServerError, "INTERNAL", "Error al cargar cotizaciones.")
			return
		}
		if quotes == nil {
			quotes = []repositories.FXQuote{}
		}
		RespondJSON(w, http.StatusOK, quotes)
	}
}

func createFXQuoteHandler(repo *repositories.FXQuoteRepo) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 4096)
		var input struct {
			FromCurrencyID string `json:"from_currency_id"`
			ToCurrencyID   string `json:"to_currency_id"`
			Rate           string `json:"rate"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "Datos inválidos.")
			return
		}
		if input.FromCurrencyID == "" || input.ToCurrencyID == "" || input.Rate == "" {
			RespondError(w, http.StatusBadRequest, "MISSING_FIELDS", "Completá todos los campos.")
			return
		}
		if input.FromCurrencyID == input.ToCurrencyID {
			RespondError(w, http.StatusBadRequest, "SAME_CURRENCY", "Las divisas deben ser distintas.")
			return
		}

		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
		q, err := repo.Create(r.Context(), input.FromCurrencyID, input.ToCurrencyID, input.Rate, claims.UserID)
		if err != nil {
			RespondError(w, http.StatusConflict, "DUPLICATE", "Ya existe una cotización para ese par de divisas.")
			return
		}
		RespondJSON(w, http.StatusCreated, q)
	}
}

func updateFXQuoteHandler(repo *repositories.FXQuoteRepo) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 4096)
		id := r.PathValue("id")
		if id == "" {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "id requerido")
			return
		}

		var input struct {
			Rate   string `json:"rate"`
			Active *bool  `json:"active"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "Datos inválidos.")
			return
		}
		if input.Rate == "" {
			RespondError(w, http.StatusBadRequest, "MISSING_RATE", "La cotización es obligatoria.")
			return
		}

		active := true
		if input.Active != nil {
			active = *input.Active
		}

		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
		q, err := repo.Update(r.Context(), id, input.Rate, active, claims.UserID)
		if err != nil {
			RespondError(w, http.StatusNotFound, "NOT_FOUND", "Cotización no encontrada.")
			return
		}
		RespondJSON(w, http.StatusOK, q)
	}
}
