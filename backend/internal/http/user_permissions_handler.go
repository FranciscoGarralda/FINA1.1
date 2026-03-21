package http

import (
	"encoding/json"
	"errors"
	"net/http"

	"fina/internal/auth"
	"fina/internal/services"
)

func getUserPermissionsHandler(svc *services.UserPermissionsService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.PathValue("id")
		if userID == "" {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "id requerido")
			return
		}

		role, items, err := svc.GetUserPermissionMatrix(r.Context(), userID)
		if err != nil {
			if errors.Is(err, services.ErrUserNotFound) {
				RespondError(w, http.StatusNotFound, "NOT_FOUND", "Usuario no encontrado.")
				return
			}
			RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "No se pudieron cargar los permisos.")
			return
		}

		RespondJSON(w, http.StatusOK, map[string]interface{}{
			"user_id": userID,
			"role":    role,
			"items":   items,
		})
	}
}

func putUserPermissionsHandler(svc *services.UserPermissionsService) http.HandlerFunc {
	type itemInput struct {
		Key     string `json:"key"`
		Allowed bool   `json:"allowed"`
	}
	type request struct {
		Items []itemInput `json:"items"`
	}

	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.PathValue("id")
		if userID == "" {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "id requerido")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)

		var req request
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "Datos inválidos.")
			return
		}

		updates := make([]services.UserPermissionUpdate, 0, len(req.Items))
		for _, item := range req.Items {
			if item.Key == "" {
				continue
			}
			updates = append(updates, services.UserPermissionUpdate{
				Key:     item.Key,
				Allowed: item.Allowed,
			})
		}

		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
		if err := svc.UpsertUserPermissions(r.Context(), userID, claims.UserID, updates); err != nil {
			if errors.Is(err, services.ErrUserNotFound) {
				RespondError(w, http.StatusNotFound, "NOT_FOUND", "Usuario no encontrado.")
				return
			}
			RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "No se pudieron guardar los permisos.")
			return
		}

		RespondJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

func resetUserPermissionsHandler(svc *services.UserPermissionsService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.PathValue("id")
		if userID == "" {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "id requerido")
			return
		}

		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
		if err := svc.ClearUserOverrides(r.Context(), userID, claims.UserID); err != nil {
			if errors.Is(err, services.ErrUserNotFound) {
				RespondError(w, http.StatusNotFound, "NOT_FOUND", "Usuario no encontrado.")
				return
			}
			RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "No se pudieron restaurar los permisos.")
			return
		}

		RespondJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}
