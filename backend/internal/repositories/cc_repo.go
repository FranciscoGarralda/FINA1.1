package repositories

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type CCRepo struct {
	pool *pgxpool.Pool
}

func NewCCRepo(pool *pgxpool.Pool) *CCRepo {
	return &CCRepo{pool: pool}
}

type CCBalanceSummary struct {
	ClientID   string            `json:"client_id"`
	ClientCode int64             `json:"client_code"`
	FirstName  string            `json:"first_name"`
	LastName   string            `json:"last_name"`
	Balances   []CCCurrencyBalance `json:"balances"`
}

type CCCurrencyBalance struct {
	CurrencyID   string `json:"currency_id"`
	CurrencyCode string `json:"currency_code"`
	Balance      string `json:"balance"`
}

type CCEntryItem struct {
	ID              string    `json:"id"`
	CurrencyCode    string    `json:"currency_code"`
	Amount          string    `json:"amount"`
	OperationNumber *int64    `json:"operation_number"`
	Note            *string   `json:"note"`
	CreatedAt       time.Time `json:"created_at"`
}

// CCEntryExportRow filas del CSV de export (solo asientos CC del cliente; filtro por fecha de operación).
type CCEntryExportRow struct {
	CreatedAt       time.Time
	MovementDate    time.Time
	MovementType    string
	OperationNumber *int64
	CurrencyCode    string
	Amount          string
	Note            string
}

// ApplyCCEntry atomically upserts cc_balances and inserts a cc_entry within the given transaction.
// The amount is applied as-is (negative = client owes more, positive = debt reduction).
func (r *CCRepo) ApplyCCEntry(ctx context.Context, tx pgx.Tx, clientID, currencyID, amount, movementID string, note *string) (string, error) {
	var newBalance string
	err := tx.QueryRow(ctx,
		`INSERT INTO cc_balances (client_id, currency_id, balance)
		 VALUES ($1, $2, $3::numeric)
		 ON CONFLICT (client_id, currency_id)
		 DO UPDATE SET balance = cc_balances.balance + $3::numeric, updated_at = now()
		 RETURNING balance::text`,
		clientID, currencyID, amount).Scan(&newBalance)
	if err != nil {
		return "", err
	}

	_, err = tx.Exec(ctx,
		`INSERT INTO cc_entries (client_id, currency_id, amount, movement_id, note)
		 VALUES ($1, $2, $3::numeric, $4, $5)`,
		clientID, currencyID, amount, movementID, note)
	if err != nil {
		return "", err
	}

	return newBalance, nil
}

func (r *CCRepo) ListBalances(ctx context.Context) ([]CCBalanceSummary, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT cb.client_id::text, cl.client_code, cl.first_name, cl.last_name,
		        cb.currency_id::text, c.code, cb.balance::text
		 FROM cc_balances cb
		 JOIN clients cl ON cl.id = cb.client_id
		 JOIN currencies c ON c.id = cb.currency_id
		 WHERE cb.balance != 0
		 ORDER BY cl.last_name, cl.first_name, c.code`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	clientMap := make(map[string]*CCBalanceSummary)
	var order []string

	for rows.Next() {
		var clientID, currencyID, currencyCode, balance string
		var clientCode int64
		var firstName, lastName string
		if err := rows.Scan(&clientID, &clientCode, &firstName, &lastName, &currencyID, &currencyCode, &balance); err != nil {
			return nil, err
		}

		summary, ok := clientMap[clientID]
		if !ok {
			summary = &CCBalanceSummary{
				ClientID:   clientID,
				ClientCode: clientCode,
				FirstName:  firstName,
				LastName:   lastName,
				Balances:   []CCCurrencyBalance{},
			}
			clientMap[clientID] = summary
			order = append(order, clientID)
		}
		summary.Balances = append(summary.Balances, CCCurrencyBalance{
			CurrencyID:   currencyID,
			CurrencyCode: currencyCode,
			Balance:      balance,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	result := make([]CCBalanceSummary, 0, len(order))
	for _, id := range order {
		result = append(result, *clientMap[id])
	}
	return result, nil
}

func (r *CCRepo) GetClientBalances(ctx context.Context, clientID string) ([]CCCurrencyBalance, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT cb.currency_id::text, c.code, cb.balance::text
		 FROM cc_balances cb
		 JOIN currencies c ON c.id = cb.currency_id
		 WHERE cb.client_id = $1
		 ORDER BY c.code`, clientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []CCCurrencyBalance
	for rows.Next() {
		var item CCCurrencyBalance
		if err := rows.Scan(&item.CurrencyID, &item.CurrencyCode, &item.Balance); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *CCRepo) ListEntries(ctx context.Context, clientID, currencyID string) ([]CCEntryItem, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT ce.id::text, c.code, ce.amount::text, m.operation_number, ce.note, ce.created_at
		 FROM cc_entries ce
		 JOIN currencies c ON c.id = ce.currency_id
		 JOIN movements m ON m.id = ce.movement_id
		 WHERE ce.client_id = $1 AND ce.currency_id = $2
		 ORDER BY ce.created_at DESC`, clientID, currencyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []CCEntryItem
	for rows.Next() {
		var item CCEntryItem
		if err := rows.Scan(&item.ID, &item.CurrencyCode, &item.Amount, &item.OperationNumber, &item.Note, &item.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// GetClientCodeForExport devuelve client_code si el cliente existe.
func (r *CCRepo) GetClientCodeForExport(ctx context.Context, clientID string) (int64, error) {
	var code int64
	err := r.pool.QueryRow(ctx, `SELECT client_code FROM clients WHERE id = $1::uuid`, clientID).Scan(&code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrNotFound
		}
		return 0, err
	}
	return code, nil
}

// ListEntriesForExport lista cc_entries del cliente entre fechas de operación (movements.date), todas las divisas.
func (r *CCRepo) ListEntriesForExport(ctx context.Context, clientID string, fromDate, toDate time.Time) ([]CCEntryExportRow, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT ce.created_at, m.date, m.type, m.operation_number, c.code, ce.amount::text, COALESCE(ce.note, '')
		 FROM cc_entries ce
		 JOIN movements m ON m.id = ce.movement_id
		 JOIN currencies c ON c.id = ce.currency_id
		 WHERE ce.client_id = $1::uuid
		   AND m.date >= $2::date AND m.date <= $3::date
		 ORDER BY ce.created_at ASC, ce.id ASC`,
		clientID, fromDate, toDate)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []CCEntryExportRow
	for rows.Next() {
		var row CCEntryExportRow
		if err := rows.Scan(&row.CreatedAt, &row.MovementDate, &row.MovementType, &row.OperationNumber, &row.CurrencyCode, &row.Amount, &row.Note); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}
