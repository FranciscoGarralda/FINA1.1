package repositories

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

type CashPositionRow struct {
	AccountID    string `json:"account_id"`
	AccountName  string `json:"account_name"`
	CurrencyID   string `json:"currency_id"`
	CurrencyCode string `json:"currency_code"`
	Format       string `json:"format"`
	Balance      string `json:"balance"`
}

type CashPositionRepo struct {
	pool *pgxpool.Pool
}

func NewCashPositionRepo(pool *pgxpool.Pool) *CashPositionRepo {
	return &CashPositionRepo{pool: pool}
}

func (r *CashPositionRepo) ListPositions(ctx context.Context, asOfDate string) ([]CashPositionRow, error) {
	query := `
		SELECT a.id::text, a.name, c.id::text, c.code, ml.format,
		       COALESCE(SUM(CASE WHEN ml.side = 'IN' THEN ml.amount ELSE -ml.amount END), 0)::text AS balance
		FROM movement_lines ml
		JOIN movements m ON m.id = ml.movement_id
		JOIN accounts a ON a.id = ml.account_id
		JOIN currencies c ON c.id = ml.currency_id
		WHERE ml.is_pending = false`

	var args []interface{}
	if asOfDate != "" {
		query += ` AND m.date <= $1::date`
		args = append(args, asOfDate)
	}

	query += `
		GROUP BY a.id, a.name, c.id, c.code, ml.format
		ORDER BY a.name, c.code, ml.format`

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []CashPositionRow
	for rows.Next() {
		var row CashPositionRow
		if err := rows.Scan(&row.AccountID, &row.AccountName, &row.CurrencyID, &row.CurrencyCode, &row.Format, &row.Balance); err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	return result, nil
}
