package http

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"

	"fina/internal/auth"
	"fina/internal/models"
	"fina/internal/repositories"
	"fina/internal/services"
)

const maxSettingsBodySize = 4096

func getSettingsHandler(svc *services.SettingsService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		settings, err := svc.GetAll(r.Context())
		if err != nil {
			RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "error al obtener configuración")
			return
		}
		RespondJSON(w, http.StatusOK, settings)
	}
}

func putSettingsHandler(svc *services.SettingsService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxSettingsBodySize)

		var input map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "cuerpo inválido o demasiado grande")
			return
		}

		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)

		if err := svc.Update(r.Context(), input, claims.UserID); err != nil {
			if errors.Is(err, services.ErrInvalidSettings) {
				RespondError(w, http.StatusBadRequest, "INVALID_SETTINGS", "Valores de configuración inválidos.")
				return
			}
			RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "error al guardar configuración")
			return
		}

		settings, _ := svc.GetAll(r.Context())
		RespondJSON(w, http.StatusOK, settings)
	}
}

// --- Entity list handlers ---

func listUsersHandler(svc *services.SettingsService, entityRepo *repositories.EntityRepo) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		items, err := entityRepo.ListUsers(r.Context())
		if err != nil {
			RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "error al obtener usuarios")
			return
		}
		if items == nil {
			items = []models.UserListItem{}
		}
		RespondJSON(w, http.StatusOK, items)
	}
}

func listAccountsHandler(entityRepo *repositories.EntityRepo) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		items, err := entityRepo.ListAccounts(r.Context())
		if err != nil {
			RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "error al obtener cuentas")
			return
		}
		if items == nil {
			items = []models.AccountListItem{}
		}
		RespondJSON(w, http.StatusOK, items)
	}
}

func listCurrenciesHandler(entityRepo *repositories.EntityRepo) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		items, err := entityRepo.ListCurrencies(r.Context())
		if err != nil {
			RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "error al obtener divisas")
			return
		}
		if items == nil {
			items = []models.CurrencyListItem{}
		}
		RespondJSON(w, http.StatusOK, items)
	}
}

func listClientsHandler(entityRepo *repositories.EntityRepo) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		items, err := entityRepo.ListClients(r.Context())
		if err != nil {
			if st, code, msg, ok := mapPostgresClientErr(err); ok {
				log.Printf("list clients: postgres error (mapped): %v", err)
				RespondError(w, st, code, msg)
				return
			}
			log.Printf("list clients: internal error: %v", err)
			RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "error al obtener clientes")
			return
		}
		if items == nil {
			items = []models.ClientListItem{}
		}
		RespondJSON(w, http.StatusOK, items)
	}
}

// --- Entity toggle handlers ---

func toggleActiveHandler(svc *services.SettingsService, entityType string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 256)

		entityID := r.PathValue("id")
		if entityID == "" {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "id requerido")
			return
		}

		var body struct {
			Active bool `json:"active"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "cuerpo inválido")
			return
		}

		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)

		if err := svc.ToggleEntityActive(r.Context(), entityType, entityID, body.Active, claims.UserID); err != nil {
			if errors.Is(err, services.ErrCannotDeactivateSuperadmin) {
				RespondError(w, http.StatusForbidden, "FORBIDDEN", "no se puede desactivar un superadmin")
				return
			}
			if errors.Is(err, repositories.ErrNotFound) {
				RespondError(w, http.StatusNotFound, "NOT_FOUND", "entidad no encontrada")
				return
			}
			RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "error al cambiar estado")
			return
		}

		RespondJSON(w, http.StatusOK, map[string]interface{}{"id": entityID, "active": body.Active})
	}
}
