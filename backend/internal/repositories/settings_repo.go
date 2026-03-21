package repositories

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5/pgxpool"
)

type SettingsRepo struct {
	pool *pgxpool.Pool
}

func NewSettingsRepo(pool *pgxpool.Pool) *SettingsRepo {
	return &SettingsRepo{pool: pool}
}

func (r *SettingsRepo) GetAll(ctx context.Context) (map[string]json.RawMessage, error) {
	rows, err := r.pool.Query(ctx, `SELECT key, value_json FROM system_settings`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]json.RawMessage)
	for rows.Next() {
		var key string
		var value json.RawMessage
		if err := rows.Scan(&key, &value); err != nil {
			return nil, err
		}
		result[key] = value
	}
	return result, rows.Err()
}

func (r *SettingsRepo) UpsertMany(ctx context.Context, settings map[string]json.RawMessage, userID string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	for key, value := range settings {
		_, err := tx.Exec(ctx,
			`INSERT INTO system_settings (key, value_json, updated_at, updated_by_user_id)
			 VALUES ($1, $2, now(), $3)
			 ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = now(), updated_by_user_id = $3`,
			key, value, userID)
		if err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}
