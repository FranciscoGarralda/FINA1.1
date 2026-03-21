package http

import (
	"errors"
	"net/http"
	"strconv"

	"fina/internal/repositories"
	"fina/internal/services"
)

func listMovementsHandler(svc *services.MovementService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()

		page, _ := strconv.Atoi(q.Get("page"))
		if page < 1 {
			page = 1
		}
		limit, _ := strconv.Atoi(q.Get("limit"))
		if limit < 1 || limit > 100 {
			limit = 20
		}

		sortDir := q.Get("sort_dir")
		if sortDir != "asc" {
			sortDir = "desc"
		}

		f := repositories.ListMovementsFilter{
			Page:       page,
			Limit:      limit,
			DateFrom:   q.Get("date_from"),
			DateTo:     q.Get("date_to"),
			Type:       q.Get("type"),
			ClientName: q.Get("client"),
			SortBy:     q.Get("sort_by"),
			SortDir:    sortDir,
		}

		result, err := svc.List(r.Context(), f)
		if err != nil {
			RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Error al obtener movimientos.")
			return
		}
		if result.Items == nil {
			result.Items = []services.MovementListItem{}
		}

		RespondJSON(w, http.StatusOK, result)
	}
}

func listMovementDraftsHandler(svc *services.MovementService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()

		page, _ := strconv.Atoi(q.Get("page"))
		if page < 1 {
			page = 1
		}
		limit, _ := strconv.Atoi(q.Get("limit"))
		if limit < 1 || limit > 100 {
			limit = 20
		}

		f := repositories.ListDraftsFilter{
			Page:     page,
			Limit:    limit,
			DateFrom: q.Get("date_from"),
			DateTo:   q.Get("date_to"),
			Type:     q.Get("type"),
			ClientID: q.Get("client_id"),
		}

		result, err := svc.ListDrafts(r.Context(), f)
		if err != nil {
			RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Error al obtener borradores.")
			return
		}
		if result.Items == nil {
			result.Items = []services.MovementDraftListItem{}
		}
		RespondJSON(w, http.StatusOK, result)
	}
}

func getMovementHandler(svc *services.MovementService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if id == "" {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "id requerido")
			return
		}

		detail, err := svc.GetByID(r.Context(), id)
		if err != nil {
			if errors.Is(err, repositories.ErrNotFound) {
				RespondError(w, http.StatusNotFound, "NOT_FOUND", "Movimiento no encontrado.")
				return
			}
			RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Error al obtener movimiento.")
			return
		}

		RespondJSON(w, http.StatusOK, detail)
	}
}
