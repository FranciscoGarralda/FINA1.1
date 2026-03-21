package http

import (
	"net/http"
	"time"

	"fina/internal/services"
)

func reportesHandler(svc *services.ReportesService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		from := r.URL.Query().Get("from")
		to := r.URL.Query().Get("to")

		if from == "" {
			from = time.Now().Format("2006-01-02")
		}
		if to == "" {
			to = time.Now().Format("2006-01-02")
		}

		baseCurrencyID := r.URL.Query().Get("base_currency_id")

		resp, err := svc.GenerateWithCodes(r.Context(), from, to, baseCurrencyID)
		if err != nil {
			RespondError(w, http.StatusInternalServerError, "INTERNAL", "Error al generar reporte.")
			return
		}

		RespondJSON(w, http.StatusOK, resp)
	}
}
