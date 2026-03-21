package repositories

import (
	"context"
	"errors"

	"fina/internal/models"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type CurrencyRepo struct {
	pool *pgxpool.Pool
}

func NewCurrencyRepo(pool *pgxpool.Pool) *CurrencyRepo {
	return &CurrencyRepo{pool: pool}
}

func (r *CurrencyRepo) FindByID(ctx context.Context, id string) (*models.CurrencyListItem, error) {
	var c models.CurrencyListItem
	err := r.pool.QueryRow(ctx,
		`SELECT id::text, code, name, active FROM currencies WHERE id = $1`, id).
		Scan(&c.ID, &c.Code, &c.Name, &c.Active)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &c, nil
}

func (r *CurrencyRepo) Create(ctx context.Context, code, name string) (string, error) {
	var id string
	err := r.pool.QueryRow(ctx,
		`INSERT INTO currencies (code, name) VALUES ($1, $2) RETURNING id::text`,
		code, name).Scan(&id)
	return id, err
}

func (r *CurrencyRepo) Update(ctx context.Context, id, code, name string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE currencies SET code=$2, name=$3, updated_at=now() WHERE id=$1`,
		id, code, name)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
