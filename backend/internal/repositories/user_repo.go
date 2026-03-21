package repositories

import (
	"context"
	"errors"
	"time"

	"fina/internal/models"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("not found")

type UserRepo struct {
	pool *pgxpool.Pool
}

func NewUserRepo(pool *pgxpool.Pool) *UserRepo {
	return &UserRepo{pool: pool}
}

func (r *UserRepo) FindByUsername(ctx context.Context, username string) (*models.User, error) {
	query := `SELECT id, username, password_hash, role, pin_hash, active,
	                  failed_login_attempts, locked_until, created_at, updated_at
	           FROM users WHERE username = $1`
	var u models.User
	err := r.pool.QueryRow(ctx, query, username).Scan(
		&u.ID, &u.Username, &u.PasswordHash, &u.Role, &u.PinHash,
		&u.Active, &u.FailedLoginAttempts, &u.LockedUntil,
		&u.CreatedAt, &u.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &u, nil
}

func (r *UserRepo) FindByID(ctx context.Context, id string) (*models.User, error) {
	query := `SELECT id, username, password_hash, role, pin_hash, active,
	                  failed_login_attempts, locked_until, created_at, updated_at
	           FROM users WHERE id = $1`
	var u models.User
	err := r.pool.QueryRow(ctx, query, id).Scan(
		&u.ID, &u.Username, &u.PasswordHash, &u.Role, &u.PinHash,
		&u.Active, &u.FailedLoginAttempts, &u.LockedUntil,
		&u.CreatedAt, &u.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &u, nil
}

func (r *UserRepo) Create(ctx context.Context, username, passwordHash, role string, pinHash *string) (string, error) {
	var id string
	err := r.pool.QueryRow(ctx,
		`INSERT INTO users (username, password_hash, role, pin_hash)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id::text`,
		username, passwordHash, role, pinHash).Scan(&id)
	return id, err
}

func (r *UserRepo) Update(ctx context.Context, id, username, role string, passwordHash *string, pinHash *string, clearPin bool) error {
	if passwordHash != nil && clearPin {
		_, err := r.pool.Exec(ctx,
			`UPDATE users SET username=$2, role=$3, password_hash=$4, pin_hash=NULL, updated_at=now() WHERE id=$1`,
			id, username, role, *passwordHash)
		return err
	}
	if passwordHash != nil && pinHash != nil {
		_, err := r.pool.Exec(ctx,
			`UPDATE users SET username=$2, role=$3, password_hash=$4, pin_hash=$5, updated_at=now() WHERE id=$1`,
			id, username, role, *passwordHash, *pinHash)
		return err
	}
	if passwordHash != nil {
		_, err := r.pool.Exec(ctx,
			`UPDATE users SET username=$2, role=$3, password_hash=$4, updated_at=now() WHERE id=$1`,
			id, username, role, *passwordHash)
		return err
	}
	if clearPin {
		_, err := r.pool.Exec(ctx,
			`UPDATE users SET username=$2, role=$3, pin_hash=NULL, updated_at=now() WHERE id=$1`,
			id, username, role)
		return err
	}
	if pinHash != nil {
		_, err := r.pool.Exec(ctx,
			`UPDATE users SET username=$2, role=$3, pin_hash=$4, updated_at=now() WHERE id=$1`,
			id, username, role, *pinHash)
		return err
	}
	_, err := r.pool.Exec(ctx,
		`UPDATE users SET username=$2, role=$3, updated_at=now() WHERE id=$1`,
		id, username, role)
	return err
}

func (r *UserRepo) UpdatePassword(ctx context.Context, id, passwordHash string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE users SET password_hash=$2, failed_login_attempts=0, locked_until=NULL, updated_at=now() WHERE id=$1`,
		id, passwordHash)
	return err
}

func (r *UserRepo) IncrementFailedAttempts(ctx context.Context, userID pgtype.UUID) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE users SET failed_login_attempts = failed_login_attempts + 1, updated_at = now() WHERE id = $1`,
		userID)
	return err
}

func (r *UserRepo) LockUser(ctx context.Context, userID pgtype.UUID, until time.Time) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE users SET locked_until = $2, updated_at = now() WHERE id = $1`,
		userID, until)
	return err
}

func (r *UserRepo) ResetFailedAttempts(ctx context.Context, userID pgtype.UUID) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE users SET failed_login_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = $1`,
		userID)
	return err
}

func (r *UserRepo) UpdatePinHash(ctx context.Context, id, pinHash string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE users SET pin_hash=$2, updated_at=now() WHERE id=$1`,
		id, pinHash)
	return err
}
