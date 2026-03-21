package http

import (
	"encoding/json"
	"errors"
	"net/http"

	"fina/internal/services"
)

const maxLoginBodySize = 1024

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type pinLoginRequest struct {
	Username string `json:"username"`
	Pin      string `json:"pin"`
}

type loginResponse struct {
	Token  string `json:"token"`
	Role   string `json:"role"`
	UserID string `json:"user_id"`
}

func loginHandler(authSvc *services.AuthService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxLoginBodySize)

		var req loginRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "cuerpo inválido o demasiado grande")
			return
		}

		token, role, userID, err := authSvc.LoginWithPassword(r.Context(), req.Username, req.Password)
		if err != nil {
			handleAuthError(w, err)
			return
		}

		RespondJSON(w, http.StatusOK, loginResponse{Token: token, Role: role, UserID: userID})
	}
}

func loginPINHandler(authSvc *services.AuthService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxLoginBodySize)

		var req pinLoginRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "cuerpo inválido o demasiado grande")
			return
		}

		token, role, userID, err := authSvc.LoginWithPIN(r.Context(), req.Username, req.Pin)
		if err != nil {
			handleAuthError(w, err)
			return
		}

		RespondJSON(w, http.StatusOK, loginResponse{Token: token, Role: role, UserID: userID})
	}
}

func handleAuthError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, services.ErrAccountLocked):
		RespondError(w, 423, "ACCOUNT_LOCKED", "cuenta bloqueada temporalmente")
	case errors.Is(err, services.ErrAccountInactive):
		RespondError(w, http.StatusUnauthorized, "ACCOUNT_INACTIVE", "cuenta inactiva")
	default:
		RespondError(w, http.StatusUnauthorized, "INVALID_CREDENTIALS", "credenciales inválidas")
	}
}
