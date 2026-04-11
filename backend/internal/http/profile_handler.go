package http

import (
	"encoding/json"
	"errors"
	"net/http"

	"fina/internal/auth"
	"fina/internal/models"
	"fina/internal/repositories"
	"fina/internal/services"
)

type meResponse struct {
	Username    string `json:"username"`
	Role        string `json:"role"`
	Active      bool   `json:"active"`
	PinEnabled  bool   `json:"pin_enabled"`
	PinMinLen   int    `json:"pin_min_length"`
	PinMaxLen   int    `json:"pin_max_length"`
}

func getMeHandler(userRepo *repositories.UserRepo, settingsRepo *repositories.SettingsRepo) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)

		user, err := userRepo.FindByID(r.Context(), claims.UserID)
		if err != nil {
			if errors.Is(err, repositories.ErrNotFound) {
				RespondError(w, http.StatusNotFound, "NOT_FOUND", "Usuario no encontrado.")
				return
			}
			RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Error interno del servidor.")
			return
		}

		settings, err := settingsRepo.GetAll(r.Context())
		if err != nil {
			RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Error interno del servidor.")
			return
		}

		pinEnabled := false
		if user.Role == "COURIER" {
			pe := true
			if raw, ok := settings["pin_enabled_for_courier"]; ok {
				json.Unmarshal(raw, &pe)
			} else if raw, ok := models.SettingsDefaults["pin_enabled_for_courier"]; ok {
				json.Unmarshal(raw, &pe)
			}
			pinEnabled = pe
		}

		minLen := 4
		maxLen := 8
		if raw, ok := settings["pin_min_length"]; ok {
			json.Unmarshal(raw, &minLen)
		} else if raw, ok := models.SettingsDefaults["pin_min_length"]; ok {
			json.Unmarshal(raw, &minLen)
		}
		if raw, ok := settings["pin_max_length"]; ok {
			json.Unmarshal(raw, &maxLen)
		} else if raw, ok := models.SettingsDefaults["pin_max_length"]; ok {
			json.Unmarshal(raw, &maxLen)
		}

		RespondJSON(w, http.StatusOK, meResponse{
			Username:   user.Username,
			Role:       user.Role,
			Active:     user.Active,
			PinEnabled: pinEnabled,
			PinMinLen:  minLen,
			PinMaxLen:  maxLen,
		})
	}
}

func changeOwnPasswordHandler(svc *services.UserService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxUserBodySize)

		var input services.ChangePasswordInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "Datos inválidos.")
			return
		}

		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
		if err := svc.ChangeOwnPassword(r.Context(), claims.UserID, input); err != nil {
			handleProfileError(w, err)
			return
		}

		RespondJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

func changeOwnPinHandler(svc *services.UserService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxUserBodySize)

		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
		if claims.Role != "COURIER" {
			RespondError(w, http.StatusForbidden, "FORBIDDEN", "No tenés permisos para acceder.")
			return
		}

		var input services.ChangePinInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "Datos inválidos.")
			return
		}

		if err := svc.ChangeOwnPin(r.Context(), claims.UserID, input); err != nil {
			handleProfileError(w, err)
			return
		}

		RespondJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

func handleProfileError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, services.ErrCurrentPasswordInvalid):
		RespondError(w, http.StatusUnauthorized, "INVALID_CREDENTIALS", "La contraseña actual es incorrecta.")
	case errors.Is(err, services.ErrNewPasswordRequired):
		RespondError(w, http.StatusBadRequest, "VALIDATION", "La nueva contraseña es obligatoria.")
	case errors.Is(err, services.ErrPasswordTooShort):
		RespondError(w, http.StatusBadRequest, "VALIDATION", "La contraseña debe tener al menos 8 caracteres.")
	case errors.Is(err, services.ErrCurrentPinInvalid):
		RespondError(w, http.StatusUnauthorized, "INVALID_CREDENTIALS", "El PIN actual es incorrecto.")
	case errors.Is(err, services.ErrNewPinRequired):
		RespondError(w, http.StatusBadRequest, "VALIDATION", "El nuevo PIN es obligatorio.")
	case errors.Is(err, services.ErrPinInvalidLength):
		RespondError(w, http.StatusBadRequest, "VALIDATION", "El PIN no cumple con el largo requerido.")
	case errors.Is(err, services.ErrNotCourier):
		RespondError(w, http.StatusForbidden, "FORBIDDEN", "No tenés permisos para acceder.")
	case errors.Is(err, services.ErrPinNotEnabled):
		RespondError(w, http.StatusForbidden, "FORBIDDEN", "No tenés permisos para acceder.")
	case errors.Is(err, repositories.ErrNotFound):
		RespondError(w, http.StatusNotFound, "NOT_FOUND", "Usuario no encontrado.")
	default:
		RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Error interno del servidor.")
	}
}
