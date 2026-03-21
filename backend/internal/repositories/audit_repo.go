package repositories

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type AuditRepo struct {
	pool *pgxpool.Pool
}

func NewAuditRepo(pool *pgxpool.Pool) *AuditRepo {
	return &AuditRepo{pool: pool}
}

func (r *AuditRepo) InsertTx(ctx context.Context, tx pgx.Tx, entityType string, entityID *string, action string, before, after interface{}, userID string) error {
	beforeJSON, _ := json.Marshal(before)
	afterJSON, _ := json.Marshal(after)

	_, err := tx.Exec(ctx,
		`INSERT INTO audit_logs (entity_type, entity_id, action, before_json, after_json, user_id)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		entityType, entityID, action, beforeJSON, afterJSON, userID)
	return err
}

func (r *AuditRepo) Insert(ctx context.Context, entityType string, entityID *string, action string, before, after interface{}, userID string) error {
	beforeJSON, _ := json.Marshal(before)
	afterJSON, _ := json.Marshal(after)

	_, err := r.pool.Exec(ctx,
		`INSERT INTO audit_logs (entity_type, entity_id, action, before_json, after_json, user_id)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		entityType, entityID, action, beforeJSON, afterJSON, userID)
	return err
}
