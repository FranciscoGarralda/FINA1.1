package repositories

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PermissionCatalogItem struct {
	Key         string  `json:"key"`
	Module      string  `json:"module"`
	Label       string  `json:"label"`
	Description *string `json:"description,omitempty"`
}

type RolePermissionRow struct {
	Key         string  `json:"key"`
	Module      string  `json:"module"`
	Label       string  `json:"label"`
	Description *string `json:"description,omitempty"`
	Allowed     *bool   `json:"allowed,omitempty"`
}

type PermissionsRepo struct {
	pool *pgxpool.Pool
}

func NewPermissionsRepo(pool *pgxpool.Pool) *PermissionsRepo {
	return &PermissionsRepo{pool: pool}
}

func IsUndefinedTableErr(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "42P01"
	}
	return false
}

func (r *PermissionsRepo) ListCatalog(ctx context.Context) ([]PermissionCatalogItem, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT key, module, label, description
		FROM permissions
		ORDER BY module, key`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]PermissionCatalogItem, 0)
	for rows.Next() {
		var item PermissionCatalogItem
		if err := rows.Scan(&item.Key, &item.Module, &item.Label, &item.Description); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (r *PermissionsRepo) ListRoleMatrix(ctx context.Context, role string) ([]RolePermissionRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT p.key, p.module, p.label, p.description, rp.allowed
		FROM permissions p
		LEFT JOIN role_permissions rp
			ON rp.permission_key = p.key
			AND rp.role = $1
		ORDER BY p.module, p.key`, role)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]RolePermissionRow, 0)
	for rows.Next() {
		var row RolePermissionRow
		if err := rows.Scan(&row.Key, &row.Module, &row.Label, &row.Description, &row.Allowed); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func (r *PermissionsRepo) UpsertRolePermissions(ctx context.Context, role string, updates map[string]bool, updatedBy string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	for key, allowed := range updates {
		tag, err := tx.Exec(ctx, `
			INSERT INTO role_permissions (role, permission_key, allowed, updated_at, updated_by)
			VALUES ($1, $2, $3, now(), $4)
			ON CONFLICT (role, permission_key)
			DO UPDATE SET allowed = EXCLUDED.allowed, updated_at = now(), updated_by = EXCLUDED.updated_by`,
			role, key, allowed, updatedBy)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return fmt.Errorf("cannot upsert permission %s for role %s", key, role)
		}
	}

	return tx.Commit(ctx)
}

func (r *PermissionsRepo) GetRolePermission(ctx context.Context, role, permissionKey string) (*bool, bool, error) {
	var allowed *bool
	err := r.pool.QueryRow(ctx, `
		SELECT rp.allowed
		FROM permissions p
		LEFT JOIN role_permissions rp
			ON rp.permission_key = p.key
			AND rp.role = $1
		WHERE p.key = $2`,
		role, permissionKey,
	).Scan(&allowed)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, false, nil
		}
		return nil, false, err
	}
	return allowed, true, nil
}
