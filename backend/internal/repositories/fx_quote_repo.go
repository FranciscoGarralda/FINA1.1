package repositories

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type FXQuote struct {
	ID               string    `json:"id"`
	FromCurrencyID   string    `json:"from_currency_id"`
	FromCurrencyCode string    `json:"from_currency_code"`
	ToCurrencyID     string    `json:"to_currency_id"`
	ToCurrencyCode   string    `json:"to_currency_code"`
	Rate             string    `json:"rate"`
	Active           bool      `json:"active"`
	UpdatedAt        time.Time `json:"updated_at"`
	UpdatedBy        *string   `json:"updated_by"`
}

type FXQuoteRepo struct {
	pool *pgxpool.Pool
}

func NewFXQuoteRepo(pool *pgxpool.Pool) *FXQuoteRepo {
	return &FXQuoteRepo{pool: pool}
}

func (r *FXQuoteRepo) List(ctx context.Context) ([]FXQuote, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT q.id::text, q.from_currency_id::text, fc.code,
		        q.to_currency_id::text, tc.code,
		        q.rate::text, q.active, q.updated_at, q.updated_by::text
		 FROM manual_fx_quotes q
		 JOIN currencies fc ON fc.id = q.from_currency_id
		 JOIN currencies tc ON tc.id = q.to_currency_id
		 ORDER BY fc.code, tc.code`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var quotes []FXQuote
	for rows.Next() {
		var q FXQuote
		if err := rows.Scan(&q.ID, &q.FromCurrencyID, &q.FromCurrencyCode,
			&q.ToCurrencyID, &q.ToCurrencyCode,
			&q.Rate, &q.Active, &q.UpdatedAt, &q.UpdatedBy); err != nil {
			return nil, err
		}
		quotes = append(quotes, q)
	}
	return quotes, nil
}

func (r *FXQuoteRepo) Create(ctx context.Context, fromCurrID, toCurrID, rate, userID string) (*FXQuote, error) {
	var q FXQuote
	err := r.pool.QueryRow(ctx,
		`INSERT INTO manual_fx_quotes (from_currency_id, to_currency_id, rate, updated_by)
		 VALUES ($1, $2, $3::numeric, $4)
		 RETURNING id::text, from_currency_id::text, to_currency_id::text, rate::text, active, updated_at, updated_by::text`,
		fromCurrID, toCurrID, rate, userID).
		Scan(&q.ID, &q.FromCurrencyID, &q.ToCurrencyID, &q.Rate, &q.Active, &q.UpdatedAt, &q.UpdatedBy)
	if err != nil {
		return nil, err
	}

	r.pool.QueryRow(ctx, `SELECT code FROM currencies WHERE id=$1`, fromCurrID).Scan(&q.FromCurrencyCode)
	r.pool.QueryRow(ctx, `SELECT code FROM currencies WHERE id=$1`, toCurrID).Scan(&q.ToCurrencyCode)
	return &q, nil
}

func (r *FXQuoteRepo) Update(ctx context.Context, id, rate string, active bool, userID string) (*FXQuote, error) {
	var q FXQuote
	err := r.pool.QueryRow(ctx,
		`UPDATE manual_fx_quotes
		 SET rate = $2::numeric, active = $3, updated_at = now(), updated_by = $4
		 WHERE id = $1
		 RETURNING id::text, from_currency_id::text, to_currency_id::text, rate::text, active, updated_at, updated_by::text`,
		id, rate, active, userID).
		Scan(&q.ID, &q.FromCurrencyID, &q.ToCurrencyID, &q.Rate, &q.Active, &q.UpdatedAt, &q.UpdatedBy)
	if err != nil {
		return nil, err
	}

	r.pool.QueryRow(ctx, `SELECT code FROM currencies WHERE id=$1`, q.FromCurrencyID).Scan(&q.FromCurrencyCode)
	r.pool.QueryRow(ctx, `SELECT code FROM currencies WHERE id=$1`, q.ToCurrencyID).Scan(&q.ToCurrencyCode)
	return &q, nil
}

func (r *FXQuoteRepo) ListActiveMap(ctx context.Context) (map[string]FXQuote, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT q.id::text, q.from_currency_id::text, fc.code,
		        q.to_currency_id::text, tc.code,
		        q.rate::text, q.active, q.updated_at, q.updated_by::text
		 FROM manual_fx_quotes q
		 JOIN currencies fc ON fc.id = q.from_currency_id
		 JOIN currencies tc ON tc.id = q.to_currency_id
		 WHERE q.active = true`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	m := make(map[string]FXQuote)
	for rows.Next() {
		var q FXQuote
		if err := rows.Scan(&q.ID, &q.FromCurrencyID, &q.FromCurrencyCode,
			&q.ToCurrencyID, &q.ToCurrencyCode,
			&q.Rate, &q.Active, &q.UpdatedAt, &q.UpdatedBy); err != nil {
			return nil, err
		}
		m[q.FromCurrencyID] = q
	}
	return m, nil
}
