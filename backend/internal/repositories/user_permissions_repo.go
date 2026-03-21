package repositories

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

type UserPermissionOverride struct {
	Key     string `json:"key"`
	Allowed bool   `json:"allowed"`
}

type UserPermissionsRepo struct {
	pool *pgxpool.Pool
}

func NewUserPermissionsRepo(pool *pgxpool.Pool) *UserPermissionsRepo {
	return &UserPermissionsRepo{pool: pool}
}

func (r *UserPermissionsRepo) ListOverrides(ctx context.Context, userID string) ([]UserPermissionOverride, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT permission_key, allowed
		FROM user_permissions
		WHERE user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]UserPermissionOverride, 0)
	for rows.Next() {
		var item UserPermissionOverride
		if err := rows.Scan(&item.Key, &item.Allowed); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (r *UserPermissionsRepo) UpsertBatch(ctx context.Context, userID, updatedBy string, updates map[string]bool) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	for key, allowed := range updates {
		_, err := tx.Exec(ctx, `
			INSERT INTO user_permissions (user_id, permission_key, allowed, updated_at, updated_by)
			VALUES ($1, $2, $3, now(), $4)
			ON CONFLICT (user_id, permission_key)
			DO UPDATE SET allowed = EXCLUDED.allowed, updated_at = now(), updated_by = EXCLUDED.updated_by`,
			userID, key, allowed, updatedBy,
		)
		if err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

func (r *UserPermissionsRepo) DeleteOverrides(ctx context.Context, userID string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM user_permissions WHERE user_id = $1`, userID)
	return err
}
