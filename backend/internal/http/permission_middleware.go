package http

import (
	"context"
	"net/http"
	"strings"

	"fina/internal/auth"
	"fina/internal/services"
)

func RequirePermission(jwtSecret string, permissionSvc *services.UserPermissionsService, permissionKey string, fallbackRoles []string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := r.Header.Get("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			RespondError(w, http.StatusUnauthorized, "UNAUTHORIZED", "token faltante o inválido")
			return
		}

		claims, err := auth.ValidateToken(jwtSecret, strings.TrimPrefix(header, "Bearer "))
		if err != nil {
			RespondError(w, http.StatusUnauthorized, "UNAUTHORIZED", "token inválido o expirado")
			return
		}

		allowedByFallback := roleInList(claims.Role, fallbackRoles)
		decision := services.PermissionUnknown
		if permissionSvc != nil {
			d, err := permissionSvc.ResolvePermission(r.Context(), claims.UserID, claims.Role, permissionKey)
			if err == nil {
				decision = d
			}
		}

		allowed := allowedByFallback
		if decision == services.PermissionAllow {
			allowed = true
		} else if decision == services.PermissionDeny {
			allowed = false
		}

		if !allowed {
			RespondError(w, http.StatusForbidden, "FORBIDDEN", "No tenés permisos para acceder.")
			return
		}

		ctx := context.WithValue(r.Context(), auth.ClaimsKey, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func roleInList(role string, allowedRoles []string) bool {
	for _, r := range allowedRoles {
		if role == r {
			return true
		}
	}
	return false
}
