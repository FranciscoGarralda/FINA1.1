package repositories

import (
	"context"
	"errors"

	"fina/internal/models"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type AccountRepo struct {
	pool *pgxpool.Pool
}

func NewAccountRepo(pool *pgxpool.Pool) *AccountRepo {
	return &AccountRepo{pool: pool}
}

func (r *AccountRepo) FindByID(ctx context.Context, id string) (*models.AccountListItem, error) {
	var a models.AccountListItem
	err := r.pool.QueryRow(ctx,
		`SELECT id::text, name, active FROM accounts WHERE id = $1`, id).
		Scan(&a.ID, &a.Name, &a.Active)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &a, nil
}

func (r *AccountRepo) Create(ctx context.Context, name string) (string, error) {
	var id string
	err := r.pool.QueryRow(ctx,
		`INSERT INTO accounts (name) VALUES ($1) RETURNING id::text`, name).Scan(&id)
	return id, err
}

func (r *AccountRepo) Update(ctx context.Context, id, name string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE accounts SET name=$2, updated_at=now() WHERE id=$1`, id, name)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *AccountRepo) GetAccountCurrencies(ctx context.Context, accountID string) ([]models.AccountCurrencyItem, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT ac.currency_id::text, c.code, c.name, ac.cash_enabled, ac.digital_enabled
		 FROM account_currencies ac
		 JOIN currencies c ON c.id = ac.currency_id
		 WHERE ac.account_id = $1
		 ORDER BY c.code`, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []models.AccountCurrencyItem
	for rows.Next() {
		var item models.AccountCurrencyItem
		if err := rows.Scan(&item.CurrencyID, &item.CurrencyCode, &item.CurrencyName, &item.CashEnabled, &item.DigitalEnabled); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

type AccountCurrencyInput struct {
	CurrencyID     string `json:"currency_id"`
	CashEnabled    bool   `json:"cash_enabled"`
	DigitalEnabled bool   `json:"digital_enabled"`
}

func (r *AccountRepo) ReplaceAccountCurrencies(ctx context.Context, accountID string, items []AccountCurrencyInput) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `DELETE FROM account_currencies WHERE account_id = $1`, accountID); err != nil {
		return err
	}

	for _, item := range items {
		if _, err := tx.Exec(ctx,
			`INSERT INTO account_currencies (account_id, currency_id, cash_enabled, digital_enabled)
			 VALUES ($1, $2, $3, $4)`,
			accountID, item.CurrencyID, item.CashEnabled, item.DigitalEnabled); err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}
