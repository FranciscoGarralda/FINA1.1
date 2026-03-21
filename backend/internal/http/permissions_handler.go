package http

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"fina/internal/auth"
	"fina/internal/services"
)

func listPermissionsCatalogHandler(svc *services.PermissionsService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		items, err := svc.ListCatalog(r.Context())
		if err != nil {
			RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "No se pudo cargar el catálogo de permisos.")
			return
		}
		RespondJSON(w, http.StatusOK, map[string]interface{}{
			"items": items,
		})
	}
}

func getRolePermissionsHandler(svc *services.PermissionsService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		role := strings.ToUpper(strings.TrimSpace(r.PathValue("role")))
		matrix, err := svc.GetRoleMatrix(r.Context(), role)
		if err != nil {
			if errors.Is(err, services.ErrInvalidRole) {
				RespondError(w, http.StatusBadRequest, "INVALID_ROLE", "Rol inválido.")
				return
			}
			RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "No se pudo cargar los permisos del rol.")
			return
		}

		RespondJSON(w, http.StatusOK, map[string]interface{}{
			"role":  role,
			"items": matrix,
		})
	}
}

func putRolePermissionsHandler(svc *services.PermissionsService) http.HandlerFunc {
	type itemInput struct {
		Key     string `json:"key"`
		Allowed bool   `json:"allowed"`
	}
	type request struct {
		Items []itemInput `json:"items"`
	}

	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		role := strings.ToUpper(strings.TrimSpace(r.PathValue("role")))

		var req request
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "Datos inválidos.")
			return
		}

		updates := make([]services.RolePermissionUpdate, 0, len(req.Items))
		for _, item := range req.Items {
			if strings.TrimSpace(item.Key) == "" {
				continue
			}
			updates = append(updates, services.RolePermissionUpdate{
				Key:     item.Key,
				Allowed: item.Allowed,
			})
		}

		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
		err := svc.UpdateRolePermissions(r.Context(), role, claims.UserID, updates)
		if err != nil {
			if errors.Is(err, services.ErrInvalidRole) {
				RespondError(w, http.StatusBadRequest, "INVALID_ROLE", "Rol inválido.")
				return
			}
			RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "No se pudieron guardar los permisos.")
			return
		}

		RespondJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

func myPermissionsHandler(svc *services.UserPermissionsService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
		perms, err := svc.GetEffectivePermissions(r.Context(), claims.UserID, claims.Role)
		if err != nil {
			RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "No se pudieron cargar los permisos.")
			return
		}

		RespondJSON(w, http.StatusOK, map[string]interface{}{
			"role":        claims.Role,
			"permissions": perms,
		})
	}
}
