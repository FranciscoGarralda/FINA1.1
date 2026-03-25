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
	return result, rows.Err()
}

// AccountCurrencyTotal saldo sistema agregado (CASH + DIGITAL) por divisa en la cuenta, al corte as_of (vacío = sin tope de fecha).
type AccountCurrencyTotal struct {
	CurrencyID   string `json:"currency_id"`
	CurrencyCode string `json:"currency_code"`
	Balance      string `json:"balance"`
}

func (r *CashPositionRepo) ListAccountCurrencyTotals(ctx context.Context, accountID, asOfDate string) ([]AccountCurrencyTotal, error) {
	q := `
		SELECT c.id::text, c.code, COALESCE(agg.bal, 0)::text AS balance
		FROM account_currencies ac
		JOIN currencies c ON c.id = ac.currency_id
		LEFT JOIN (
			SELECT ml.account_id, ml.currency_id,
			       SUM(CASE WHEN ml.side = 'IN' THEN ml.amount ELSE -ml.amount END) AS bal
			FROM movement_lines ml
			INNER JOIN movements m ON m.id = ml.movement_id
			WHERE ml.is_pending = false
			  AND ($2::text = '' OR m.date <= $2::date)
			GROUP BY ml.account_id, ml.currency_id
		) agg ON agg.account_id = ac.account_id AND agg.currency_id = ac.currency_id
		WHERE ac.account_id = $1::uuid
		ORDER BY c.code`
	rows, err := r.pool.Query(ctx, q, accountID, asOfDate)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []AccountCurrencyTotal
	for rows.Next() {
		var row AccountCurrencyTotal
		if err := rows.Scan(&row.CurrencyID, &row.CurrencyCode, &row.Balance); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}
