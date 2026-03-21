package http

import (
	"net/http"

	"fina/internal/services"
)

func cashPositionHandler(svc *services.CashPositionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		asOf := r.URL.Query().Get("as_of")

		positions, err := svc.GetPositions(r.Context(), asOf)
		if err != nil {
			RespondError(w, http.StatusInternalServerError, "INTERNAL", "Error al calcular posición de caja.")
			return
		}
		if positions == nil {
			positions = []services.CashPositionAccount{}
		}

		RespondJSON(w, http.StatusOK, positions)
	}
}
