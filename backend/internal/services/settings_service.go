package services

import (
	"context"
	"encoding/json"
	"errors"
	"math"

	"fina/internal/models"
	"fina/internal/repositories"
)

var ErrInvalidSettings = errors.New("INVALID_SETTINGS")
var ErrCannotDeactivateSuperadmin = errors.New("CANNOT_DEACTIVATE_SUPERADMIN")

type SettingsService struct {
	settingsRepo *repositories.SettingsRepo
	entityRepo   *repositories.EntityRepo
	auditRepo    *repositories.AuditRepo
}

func NewSettingsService(sr *repositories.SettingsRepo, er *repositories.EntityRepo, ar *repositories.AuditRepo) *SettingsService {
	return &SettingsService{settingsRepo: sr, entityRepo: er, auditRepo: ar}
}

func (s *SettingsService) GetAll(ctx context.Context) (map[string]json.RawMessage, error) {
	stored, err := s.settingsRepo.GetAll(ctx)
	if err != nil {
		return nil, err
	}

	merged := make(map[string]json.RawMessage)
	for k, v := range models.SettingsDefaults {
		merged[k] = v
	}
	for k, v := range stored {
		if models.IsValidSettingsKey(k) {
			merged[k] = v
		}
	}
	return merged, nil
}

func (s *SettingsService) Update(ctx context.Context, input map[string]json.RawMessage, userID string) error {
	for key := range input {
		if !models.IsValidSettingsKey(key) {
			return ErrInvalidSettings
		}
	}

	current, err := s.GetAll(ctx)
	if err != nil {
		return err
	}

	merged := make(map[string]json.RawMessage)
	for k, v := range current {
		merged[k] = v
	}
	for k, v := range input {
		merged[k] = v
	}

	if err := validateSettings(merged); err != nil {
		return err
	}

	beforeMap := current
	if err := s.settingsRepo.UpsertMany(ctx, input, userID); err != nil {
		return err
	}

	afterMap, _ := s.GetAll(ctx)
	s.auditRepo.Insert(ctx, "settings", nil, "update", beforeMap, afterMap, userID)

	return nil
}

func (s *SettingsService) ToggleEntityActive(ctx context.Context, entityType, entityID string, active bool, userID string) error {
	if entityType == "users" && !active {
		role, err := s.entityRepo.GetUserRole(ctx, entityID)
		if err != nil {
			return err
		}
		if role == "SUPERADMIN" {
			return ErrCannotDeactivateSuperadmin
		}
	}

	beforeActive, err := s.entityRepo.GetEntityActiveStatus(ctx, entityType, entityID)
	if err != nil {
		return err
	}

	var toggleErr error
	switch entityType {
	case "users":
		toggleErr = s.entityRepo.ToggleUserActive(ctx, entityID, active)
	case "accounts":
		toggleErr = s.entityRepo.ToggleAccountActive(ctx, entityID, active)
	case "currencies":
		toggleErr = s.entityRepo.ToggleCurrencyActive(ctx, entityID, active)
	case "clients":
		toggleErr = s.entityRepo.ToggleClientActive(ctx, entityID, active)
	default:
		return ErrInvalidSettings
	}
	if toggleErr != nil {
		return toggleErr
	}

	s.auditRepo.Insert(ctx, entityType, &entityID, "toggle_active",
		map[string]bool{"active": beforeActive},
		map[string]bool{"active": active},
		userID)

	return nil
}

func validateSettings(merged map[string]json.RawMessage) error {
	getFloat := func(key string) (float64, bool) {
		raw, ok := merged[key]
		if !ok {
			return 0, false
		}
		var v float64
		if err := json.Unmarshal(raw, &v); err != nil {
			return 0, false
		}
		return v, true
	}

	getBool := func(key string) bool {
		raw, ok := merged[key]
		if !ok {
			return false
		}
		var v bool
		json.Unmarshal(raw, &v)
		return v
	}

	_ = getBool

	if v, ok := getFloat("lockout_max_attempts"); ok {
		if v < 1 || v != math.Floor(v) {
			return ErrInvalidSettings
		}
	}
	if v, ok := getFloat("lockout_minutes"); ok {
		if v < 1 || v != math.Floor(v) {
			return ErrInvalidSettings
		}
	}

	pinMin, minOk := getFloat("pin_min_length")
	pinMax, maxOk := getFloat("pin_max_length")

	if minOk && pinMin < 4 {
		return ErrInvalidSettings
	}
	if maxOk && pinMax > 8 {
		return ErrInvalidSettings
	}
	if minOk && maxOk && pinMin > pinMax {
		return ErrInvalidSettings
	}

	return nil
}
