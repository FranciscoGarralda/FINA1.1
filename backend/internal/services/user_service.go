package services

import (
	"context"
	"encoding/json"
	"errors"

	"fina/internal/repositories"

	"golang.org/x/crypto/bcrypt"
)

var (
	ErrUsernameRequired       = errors.New("USERNAME_REQUIRED")
	ErrPasswordRequired       = errors.New("PASSWORD_REQUIRED")
	ErrPinRequired            = errors.New("PIN_REQUIRED")
	ErrPinInvalidLength       = errors.New("PIN_INVALID_LENGTH")
	ErrCannotEditSuperadmin   = errors.New("CANNOT_EDIT_SUPERADMIN")
	ErrCannotAssignSuperadmin = errors.New("CANNOT_ASSIGN_SUPERADMIN")
	ErrCannotResetOwnPassword = errors.New("CANNOT_RESET_OWN_PASSWORD")
	ErrCurrentPasswordInvalid = errors.New("CURRENT_PASSWORD_INVALID")
	ErrNewPasswordRequired    = errors.New("NEW_PASSWORD_REQUIRED")
	ErrCurrentPinInvalid      = errors.New("CURRENT_PIN_INVALID")
	ErrNewPinRequired         = errors.New("NEW_PIN_REQUIRED")
	ErrNotCourier             = errors.New("NOT_COURIER")
	ErrPinNotEnabled          = errors.New("PIN_NOT_ENABLED")
)

type UserService struct {
	userRepo     *repositories.UserRepo
	settingsRepo *repositories.SettingsRepo
	auditRepo    *repositories.AuditRepo
}

func NewUserService(ur *repositories.UserRepo, sr *repositories.SettingsRepo, ar *repositories.AuditRepo) *UserService {
	return &UserService{userRepo: ur, settingsRepo: sr, auditRepo: ar}
}

type CreateUserInput struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Role     string `json:"role"`
	Pin      string `json:"pin"`
}

type UpdateUserInput struct {
	Username string `json:"username"`
	Role     string `json:"role"`
	Password string `json:"password"`
	Pin      string `json:"pin"`
}

type ResetPasswordInput struct {
	Password string `json:"password"`
}

func (s *UserService) Create(ctx context.Context, input CreateUserInput, callerRole, callerID string) (string, error) {
	if input.Username == "" {
		return "", ErrUsernameRequired
	}
	if input.Password == "" {
		return "", ErrPasswordRequired
	}
	if callerRole == "SUBADMIN" && input.Role == "SUPERADMIN" {
		return "", ErrCannotAssignSuperadmin
	}

	passHash, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}

	var pinHashPtr *string
	if input.Role == "COURIER" {
		if err := s.validatePin(ctx, input.Pin); err != nil {
			return "", err
		}
		ph, err := bcrypt.GenerateFromPassword([]byte(input.Pin), bcrypt.DefaultCost)
		if err != nil {
			return "", err
		}
		phs := string(ph)
		pinHashPtr = &phs
	}

	id, err := s.userRepo.Create(ctx, input.Username, string(passHash), input.Role, pinHashPtr)
	if err != nil {
		return "", err
	}

	s.auditRepo.Insert(ctx, "user", &id, "create",
		nil,
		map[string]interface{}{"username": input.Username, "role": input.Role},
		callerID)

	return id, nil
}

func (s *UserService) Update(ctx context.Context, targetID string, input UpdateUserInput, callerRole, callerID string) error {
	if input.Username == "" {
		return ErrUsernameRequired
	}

	target, err := s.userRepo.FindByID(ctx, targetID)
	if err != nil {
		return err
	}

	if callerRole == "SUBADMIN" {
		if target.Role == "SUPERADMIN" {
			return ErrCannotEditSuperadmin
		}
		if input.Role == "SUPERADMIN" {
			return ErrCannotAssignSuperadmin
		}
	}

	beforeMap := map[string]interface{}{
		"username": target.Username,
		"role":     target.Role,
	}

	var passHashPtr *string
	if input.Password != "" {
		ph, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
		if err != nil {
			return err
		}
		phs := string(ph)
		passHashPtr = &phs
	}

	var pinHashPtr *string
	clearPin := false

	if input.Role == "COURIER" {
		if input.Pin != "" {
			if err := s.validatePin(ctx, input.Pin); err != nil {
				return err
			}
			ph, err := bcrypt.GenerateFromPassword([]byte(input.Pin), bcrypt.DefaultCost)
			if err != nil {
				return err
			}
			phs := string(ph)
			pinHashPtr = &phs
		}
	} else if target.Role == "COURIER" && input.Role != "COURIER" {
		clearPin = true
	}

	if err := s.userRepo.Update(ctx, targetID, input.Username, input.Role, passHashPtr, pinHashPtr, clearPin); err != nil {
		return err
	}

	afterMap := map[string]interface{}{
		"username": input.Username,
		"role":     input.Role,
	}

	s.auditRepo.Insert(ctx, "user", &targetID, "update", beforeMap, afterMap, callerID)

	return nil
}

func (s *UserService) ResetPassword(ctx context.Context, targetID string, input ResetPasswordInput, callerRole, callerID string) error {
	if input.Password == "" {
		return ErrPasswordRequired
	}

	if targetID == callerID {
		return ErrCannotResetOwnPassword
	}

	target, err := s.userRepo.FindByID(ctx, targetID)
	if err != nil {
		return err
	}

	if callerRole == "SUBADMIN" && target.Role == "SUPERADMIN" {
		return ErrCannotEditSuperadmin
	}

	passHash, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	if err := s.userRepo.UpdatePassword(ctx, targetID, string(passHash)); err != nil {
		return err
	}

	s.auditRepo.Insert(ctx, "user", &targetID, "reset_password", nil, nil, callerID)

	return nil
}

type ChangePasswordInput struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

type ChangePinInput struct {
	CurrentPin string `json:"current_pin"`
	NewPin     string `json:"new_pin"`
}

func (s *UserService) ChangeOwnPassword(ctx context.Context, userID string, input ChangePasswordInput) error {
	if input.CurrentPassword == "" || input.NewPassword == "" {
		return ErrNewPasswordRequired
	}

	user, err := s.userRepo.FindByID(ctx, userID)
	if err != nil {
		return err
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(input.CurrentPassword)); err != nil {
		return ErrCurrentPasswordInvalid
	}

	newHash, err := bcrypt.GenerateFromPassword([]byte(input.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	if err := s.userRepo.UpdatePassword(ctx, userID, string(newHash)); err != nil {
		return err
	}

	s.auditRepo.Insert(ctx, "user", &userID, "change_password", nil, nil, userID)
	return nil
}

func (s *UserService) ChangeOwnPin(ctx context.Context, userID string, input ChangePinInput) error {
	user, err := s.userRepo.FindByID(ctx, userID)
	if err != nil {
		return err
	}

	if user.Role != "COURIER" {
		return ErrNotCourier
	}

	settings, err := s.settingsRepo.GetAll(ctx)
	if err != nil {
		return err
	}

	pinEnabled := true
	if raw, ok := settings["pin_enabled_for_courier"]; ok {
		json.Unmarshal(raw, &pinEnabled)
	}
	if !pinEnabled {
		return ErrPinNotEnabled
	}

	if input.CurrentPin == "" || input.NewPin == "" {
		return ErrNewPinRequired
	}

	if !user.PinHash.Valid || user.PinHash.String == "" {
		return ErrCurrentPinInvalid
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PinHash.String), []byte(input.CurrentPin)); err != nil {
		return ErrCurrentPinInvalid
	}

	minLen := 4
	maxLen := 8
	if raw, ok := settings["pin_min_length"]; ok {
		json.Unmarshal(raw, &minLen)
	}
	if raw, ok := settings["pin_max_length"]; ok {
		json.Unmarshal(raw, &maxLen)
	}
	if len(input.NewPin) < minLen || len(input.NewPin) > maxLen {
		return ErrPinInvalidLength
	}

	newHash, err := bcrypt.GenerateFromPassword([]byte(input.NewPin), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	if err := s.userRepo.UpdatePinHash(ctx, userID, string(newHash)); err != nil {
		return err
	}

	s.auditRepo.Insert(ctx, "user", &userID, "change_pin", nil, nil, userID)
	return nil
}

func (s *UserService) validatePin(ctx context.Context, pin string) error {
	settings, err := s.settingsRepo.GetAll(ctx)
	if err != nil {
		return err
	}

	pinEnabled := true
	if raw, ok := settings["pin_enabled_for_courier"]; ok {
		json.Unmarshal(raw, &pinEnabled)
	}

	if pinEnabled && pin == "" {
		return ErrPinRequired
	}

	if pin == "" {
		return nil
	}

	minLen := 4
	maxLen := 8
	if raw, ok := settings["pin_min_length"]; ok {
		json.Unmarshal(raw, &minLen)
	}
	if raw, ok := settings["pin_max_length"]; ok {
		json.Unmarshal(raw, &maxLen)
	}

	if len(pin) < minLen || len(pin) > maxLen {
		return ErrPinInvalidLength
	}

	return nil
}
