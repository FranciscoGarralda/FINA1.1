package http

import (
	"net/http"

	"fina/internal/repositories"
	"fina/internal/services"
)

func listCCBalancesHandler(svc *services.CCService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		items, err := svc.GetBalances(r.Context())
		if err != nil {
			RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Error al obtener posiciones.")
			return
		}
		if items == nil {
			items = []repositories.CCBalanceSummary{}
		}
		RespondJSON(w, http.StatusOK, items)
	}
}

func getClientCCBalancesHandler(svc *services.CCService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clientID := r.PathValue("client_id")
		if clientID == "" {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "client_id requerido")
			return
		}

		items, err := svc.GetClientBalances(r.Context(), clientID)
		if err != nil {
			RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Error al obtener balances del cliente.")
			return
		}
		if items == nil {
			items = []repositories.CCCurrencyBalance{}
		}
		RespondJSON(w, http.StatusOK, items)
	}
}

func listCCEntriesHandler(svc *services.CCService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clientID := r.URL.Query().Get("client_id")
		currencyID := r.URL.Query().Get("currency_id")

		if clientID == "" || currencyID == "" {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "client_id y currency_id son requeridos")
			return
		}

		items, err := svc.GetEntries(r.Context(), clientID, currencyID)
		if err != nil {
			RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Error al obtener movimientos CC.")
			return
		}
		if items == nil {
			items = []repositories.CCEntryItem{}
		}
		RespondJSON(w, http.StatusOK, items)
	}
}
