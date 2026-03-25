package http

import (
	"net/http"
	"time"

	"fina/internal/services"
)

func dashboardDailySummaryHandler(svc *services.ReportesService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		dateStr := r.URL.Query().Get("date")
		if dateStr == "" {
			dateStr = time.Now().UTC().Format("2006-01-02")
		}
		if _, err := time.Parse("2006-01-02", dateStr); err != nil {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "date inválido; usar YYYY-MM-DD.")
			return
		}

		resp, err := svc.DailySummary(r.Context(), dateStr)
		if err != nil {
			RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Error al armar resumen diario.")
			return
		}
		RespondJSON(w, http.StatusOK, resp)
	}
}
