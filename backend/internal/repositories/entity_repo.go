package repositories

import (
	"context"
	"errors"
	"fmt"

	"fina/internal/models"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type EntityRepo struct {
	pool *pgxpool.Pool
}

func NewEntityRepo(pool *pgxpool.Pool) *EntityRepo {
	return &EntityRepo{pool: pool}
}

// --- Users ---

func (r *EntityRepo) ListUsers(ctx context.Context) ([]models.UserListItem, error) {
	rows, err := r.pool.Query(ctx, `SELECT id::text, username, role, active FROM users ORDER BY username`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []models.UserListItem
	for rows.Next() {
		var item models.UserListItem
		if err := rows.Scan(&item.ID, &item.Username, &item.Role, &item.Active); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *EntityRepo) GetUserRole(ctx context.Context, id string) (string, error) {
	var role string
	err := r.pool.QueryRow(ctx, `SELECT role FROM users WHERE id = $1`, id).Scan(&role)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrNotFound
		}
		return "", err
	}
	return role, nil
}

func (r *EntityRepo) ToggleUserActive(ctx context.Context, id string, active bool) error {
	tag, err := r.pool.Exec(ctx, `UPDATE users SET active = $2, updated_at = now() WHERE id = $1`, id, active)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// --- Accounts ---

func (r *EntityRepo) ListAccounts(ctx context.Context) ([]models.AccountListItem, error) {
	rows, err := r.pool.Query(ctx, `SELECT id::text, name, active FROM accounts ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []models.AccountListItem
	for rows.Next() {
		var item models.AccountListItem
		if err := rows.Scan(&item.ID, &item.Name, &item.Active); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *EntityRepo) ToggleAccountActive(ctx context.Context, id string, active bool) error {
	tag, err := r.pool.Exec(ctx, `UPDATE accounts SET active = $2, updated_at = now() WHERE id = $1`, id, active)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// --- Currencies ---

func (r *EntityRepo) ListCurrencies(ctx context.Context) ([]models.CurrencyListItem, error) {
	rows, err := r.pool.Query(ctx, `SELECT id::text, code, name, active FROM currencies ORDER BY code`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []models.CurrencyListItem
	for rows.Next() {
		var item models.CurrencyListItem
		if err := rows.Scan(&item.ID, &item.Code, &item.Name, &item.Active); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *EntityRepo) ToggleCurrencyActive(ctx context.Context, id string, active bool) error {
	tag, err := r.pool.Exec(ctx, `UPDATE currencies SET active = $2, updated_at = now() WHERE id = $1`, id, active)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// --- Clients ---

func (r *EntityRepo) ListClients(ctx context.Context) ([]models.ClientListItem, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id::text, client_code, first_name, last_name, phone, dni,
		        COALESCE(department, ''), active, cc_enabled
		 FROM clients ORDER BY last_name, first_name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []models.ClientListItem
	for rows.Next() {
		var item models.ClientListItem
		if err := rows.Scan(&item.ID, &item.ClientCode, &item.FirstName, &item.LastName, &item.Phone, &item.DNI, &item.Department, &item.Active, &item.CcEnabled); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *EntityRepo) ToggleClientActive(ctx context.Context, id string, active bool) error {
	tag, err := r.pool.Exec(ctx, `UPDATE clients SET active = $2, updated_at = now() WHERE id = $1`, id, active)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ErrInvalidEntityTable indica un nombre de tabla no permitido para GetEntityActiveStatus.
var ErrInvalidEntityTable = errors.New("invalid entity table")

func entityTableOrError(table string) (string, error) {
	switch table {
	case "users", "accounts", "currencies", "clients":
		return table, nil
	default:
		return "", ErrInvalidEntityTable
	}
}

func (r *EntityRepo) GetEntityActiveStatus(ctx context.Context, table, id string) (bool, error) {
	safeTable, err := entityTableOrError(table)
	if err != nil {
		return false, err
	}
	var active bool
	query := fmt.Sprintf(`SELECT active FROM %s WHERE id = $1`, safeTable)
	err = r.pool.QueryRow(ctx, query, id).Scan(&active)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, ErrNotFound
		}
		return false, err
	}
	return active, nil
}
