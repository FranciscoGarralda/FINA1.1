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

		resp, err := svc.Generate(r.Context(), from, to)
		if err != nil {
			RespondError(w, http.StatusInternalServerError, "INTERNAL", "Error al generar reporte.")
			return
		}

		RespondJSON(w, http.StatusOK, resp)
	}
}
