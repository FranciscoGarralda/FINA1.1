package http

import (
	"net/http"
	"strconv"

	"fina/internal/repositories"
	"fina/internal/services"
)

func listAuditLogsHandler(svc *services.AuditLogsService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()

		page, _ := strconv.Atoi(q.Get("page"))
		limit, _ := strconv.Atoi(q.Get("limit"))
		if page <= 0 {
			page = 1
		}
		if limit <= 0 {
			limit = 20
		}

		filter := repositories.AuditFilter{
			From:       q.Get("from"),
			To:         q.Get("to"),
			UserID:     q.Get("user_id"),
			EntityType: q.Get("entity"),
			Action:     q.Get("action"),
			Page:       page,
			Limit:      limit,
		}

		resp, err := svc.List(r.Context(), filter)
		if err != nil {
			RespondError(w, http.StatusInternalServerError, "INTERNAL", "Error al cargar auditoría.")
			return
		}

		RespondJSON(w, http.StatusOK, resp)
	}
}
