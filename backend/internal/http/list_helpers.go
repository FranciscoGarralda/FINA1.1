package http

import (
	"net/http"
)

// Helper extraído para listas de entidades (settings): err → 500; nil slice → vacío; 200 JSON.
func respondEntityListJSON[T any](w http.ResponseWriter, items []T, err error, empty []T, errMsg string) {
	if err != nil {
		RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", errMsg)
		return
	}
	if items == nil {
		items = empty
	}
	RespondJSON(w, http.StatusOK, items)
}
