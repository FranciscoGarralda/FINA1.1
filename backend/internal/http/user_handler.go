package http

import (
	"encoding/json"
	"errors"
	"net/http"

	"fina/internal/auth"
	"fina/internal/repositories"
	"fina/internal/services"
)

const maxUserBodySize = 2048

func createUserHandler(svc *services.UserService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxUserBodySize)

		var input services.CreateUserInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "cuerpo inválido o demasiado grande")
			return
		}

		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
		id, err := svc.Create(r.Context(), input, claims.Role, claims.UserID)
		if err != nil {
			handleUserError(w, err)
			return
		}

		RespondJSON(w, http.StatusCreated, map[string]string{"id": id})
	}
}

func updateUserHandler(svc *services.UserService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxUserBodySize)

		targetID := r.PathValue("id")
		if targetID == "" {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "id requerido")
			return
		}

		var input services.UpdateUserInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "cuerpo inválido o demasiado grande")
			return
		}

		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
		if err := svc.Update(r.Context(), targetID, input, claims.Role, claims.UserID); err != nil {
			handleUserError(w, err)
			return
		}

		RespondJSON(w, http.StatusOK, map[string]string{"status": "updated"})
	}
}

func resetPasswordHandler(svc *services.UserService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxUserBodySize)

		targetID := r.PathValue("id")
		if targetID == "" {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "id requerido")
			return
		}

		var input services.ResetPasswordInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "cuerpo inválido o demasiado grande")
			return
		}

		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
		if err := svc.ResetPassword(r.Context(), targetID, input, claims.Role, claims.UserID); err != nil {
			handleUserError(w, err)
			return
		}

		RespondJSON(w, http.StatusOK, map[string]string{"status": "password_reset"})
	}
}

func handleUserError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, services.ErrUsernameRequired):
		RespondError(w, http.StatusBadRequest, "VALIDATION", "El nombre de usuario es obligatorio.")
	case errors.Is(err, services.ErrPasswordRequired):
		RespondError(w, http.StatusBadRequest, "VALIDATION", "La contraseña es obligatoria.")
	case errors.Is(err, services.ErrPasswordTooShort):
		RespondError(w, http.StatusBadRequest, "VALIDATION", "La contraseña debe tener al menos 8 caracteres.")
	case errors.Is(err, services.ErrPinRequired):
		RespondError(w, http.StatusBadRequest, "VALIDATION", "El PIN es obligatorio para repartidores.")
	case errors.Is(err, services.ErrPinInvalidLength):
		RespondError(w, http.StatusBadRequest, "VALIDATION", "El PIN no cumple con el largo requerido.")
	case errors.Is(err, services.ErrCannotEditSuperadmin):
		RespondError(w, http.StatusForbidden, "FORBIDDEN", "No tenés permisos para modificar este usuario.")
	case errors.Is(err, services.ErrCannotAssignSuperadmin):
		RespondError(w, http.StatusForbidden, "FORBIDDEN", "No tenés permisos para asignar el rol SUPERADMIN.")
	case errors.Is(err, services.ErrCannotResetOwnPassword):
		RespondError(w, http.StatusForbidden, "FORBIDDEN", "No podés resetear tu propia contraseña desde este endpoint.")
	case errors.Is(err, repositories.ErrNotFound):
		RespondError(w, http.StatusNotFound, "NOT_FOUND", "Usuario no encontrado.")
	default:
		RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Error interno del servidor.")
	}
}
