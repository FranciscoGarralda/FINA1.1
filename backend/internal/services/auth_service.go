package services

import (
	"context"
	"errors"
	"time"

	"fina/internal/auth"
	"fina/internal/repositories"

	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"
)

const maxFailedAttempts = 5
const lockDuration = 15 * time.Minute

type AuthService struct {
	userRepo  *repositories.UserRepo
	jwtSecret string
}

func NewAuthService(userRepo *repositories.UserRepo, jwtSecret string) *AuthService {
	return &AuthService{userRepo: userRepo, jwtSecret: jwtSecret}
}

var (
	ErrInvalidCredentials = errors.New("INVALID_CREDENTIALS")
	ErrAccountInactive    = errors.New("ACCOUNT_INACTIVE")
	ErrAccountLocked      = errors.New("ACCOUNT_LOCKED")
)

func (s *AuthService) LoginWithPassword(ctx context.Context, username, password string) (string, string, string, error) {
	user, err := s.userRepo.FindByUsername(ctx, username)
	if err != nil {
		if errors.Is(err, repositories.ErrNotFound) {
			return "", "", "", ErrInvalidCredentials
		}
		return "", "", "", err
	}

	if !user.Active {
		return "", "", "", ErrAccountInactive
	}
	if user.LockedUntil.Valid && user.LockedUntil.Time.After(time.Now()) {
		return "", "", "", ErrAccountLocked
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		s.handleFailedAttempt(ctx, user.ID, user.FailedLoginAttempts)
		return "", "", "", ErrInvalidCredentials
	}

	s.userRepo.ResetFailedAttempts(ctx, user.ID)
	token, err := auth.GenerateToken(s.jwtSecret, user.IDString(), user.Role)
	if err != nil {
		return "", "", "", err
	}
	return token, user.Role, user.IDString(), nil
}

func (s *AuthService) LoginWithPIN(ctx context.Context, username, pin string) (string, string, string, error) {
	user, err := s.userRepo.FindByUsername(ctx, username)
	if err != nil {
		if errors.Is(err, repositories.ErrNotFound) {
			return "", "", "", ErrInvalidCredentials
		}
		return "", "", "", err
	}

	if user.Role != "COURIER" {
		return "", "", "", ErrInvalidCredentials
	}
	if !user.Active {
		return "", "", "", ErrAccountInactive
	}
	if user.LockedUntil.Valid && user.LockedUntil.Time.After(time.Now()) {
		return "", "", "", ErrAccountLocked
	}
	if !user.PinHash.Valid {
		return "", "", "", ErrInvalidCredentials
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PinHash.String), []byte(pin)); err != nil {
		s.handleFailedAttempt(ctx, user.ID, user.FailedLoginAttempts)
		return "", "", "", ErrInvalidCredentials
	}

	s.userRepo.ResetFailedAttempts(ctx, user.ID)
	token, err := auth.GenerateToken(s.jwtSecret, user.IDString(), user.Role)
	if err != nil {
		return "", "", "", err
	}
	return token, user.Role, user.IDString(), nil
}

func (s *AuthService) handleFailedAttempt(ctx context.Context, userID pgtype.UUID, currentAttempts int) {
	s.userRepo.IncrementFailedAttempts(ctx, userID)
	if currentAttempts+1 >= maxFailedAttempts {
		s.userRepo.LockUser(ctx, userID, time.Now().Add(lockDuration))
	}
}
