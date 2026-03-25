package repositories

import (
	"context"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type CashArqueoRepo struct {
	pool *pgxpool.Pool
}

func NewCashArqueoRepo(pool *pgxpool.Pool) *CashArqueoRepo {
	return &CashArqueoRepo{pool: pool}
}

func (r *CashArqueoRepo) InsertArqueoTx(ctx context.Context, tx pgx.Tx, accountID, arqueoDate string, note *string, createdByUserID string) (string, error) {
	var id string
	err := tx.QueryRow(ctx,
		`INSERT INTO cash_arqueos (account_id, arqueo_date, note, created_by_user_id)
		 VALUES ($1::uuid, $2::date, $3, $4::uuid)
		 RETURNING id::text`,
		accountID, arqueoDate, note, createdByUserID).Scan(&id)
	return id, err
}

func (r *CashArqueoRepo) InsertLineTx(ctx context.Context, tx pgx.Tx, arqueoID, currencyID, systemSnap, counted string) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO cash_arqueo_lines (cash_arqueo_id, currency_id, system_balance_snapshot, counted_total)
		 VALUES ($1::uuid, $2::uuid, $3::numeric, $4::numeric)`,
		arqueoID, currencyID, systemSnap, counted)
	return err
}

type CashArqueoListRow struct {
	ArqueoID       string
	AccountID      string
	AccountName    string
	ArqueoDate     string
	Note           *string
	CreatedByID    string
	CreatedByName  string
	CreatedAt      string
	LineID         string
	CurrencyID     string
	CurrencyCode   string
	SystemSnapshot string
	CountedTotal   string
}

func (r *CashArqueoRepo) List(ctx context.Context, accountID, fromDate, toDate string) ([]CashArqueoListRow, error) {
	q := `
		SELECT ca.id::text, a.id::text, a.name, ca.arqueo_date::text, ca.note,
		       u.id::text, u.username, ca.created_at::text,
		       l.id::text, c.id::text, c.code, l.system_balance_snapshot::text, l.counted_total::text
		FROM cash_arqueos ca
		JOIN accounts a ON a.id = ca.account_id
		JOIN users u ON u.id = ca.created_by_user_id
		JOIN cash_arqueo_lines l ON l.cash_arqueo_id = ca.id
		JOIN currencies c ON c.id = l.currency_id
		WHERE 1=1`
	args := []interface{}{}
	n := 1
	if accountID != "" {
		q += ` AND ca.account_id = $` + strconv.Itoa(n) + `::uuid`
		args = append(args, accountID)
		n++
	}
	if fromDate != "" {
		q += ` AND ca.arqueo_date >= $` + strconv.Itoa(n) + `::date`
		args = append(args, fromDate)
		n++
	}
	if toDate != "" {
		q += ` AND ca.arqueo_date <= $` + strconv.Itoa(n) + `::date`
		args = append(args, toDate)
		n++
	}
	q += ` ORDER BY ca.created_at DESC, c.code`

	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []CashArqueoListRow
	for rows.Next() {
		var row CashArqueoListRow
		if err := rows.Scan(&row.ArqueoID, &row.AccountID, &row.AccountName, &row.ArqueoDate, &row.Note,
			&row.CreatedByID, &row.CreatedByName, &row.CreatedAt,
			&row.LineID, &row.CurrencyID, &row.CurrencyCode, &row.SystemSnapshot, &row.CountedTotal); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}
