package repositories

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PendingRepo struct {
	pool *pgxpool.Pool
}

func NewPendingRepo(pool *pgxpool.Pool) *PendingRepo {
	return &PendingRepo{pool: pool}
}

type PendingListItem struct {
	ID              string    `json:"id"`
	MovementLineID  string    `json:"movement_line_id"`
	MovementID      string    `json:"movement_id"`
	OperationNumber int64     `json:"operation_number"`
	MovementType    string    `json:"movement_type"`
	Type            string    `json:"type"`
	Status          string    `json:"status"`
	ClientID        string    `json:"client_id"`
	ClientName      string    `json:"client_name"`
	AddressStreet   string    `json:"address_street"`
	AddressNumber   string    `json:"address_number"`
	AddressFloor    string    `json:"address_floor"`
	Phone           string    `json:"phone"`
	CurrencyID      string    `json:"currency_id"`
	CurrencyCode     string    `json:"currency_code"`
	Amount           string    `json:"amount"`
	AccountID        string    `json:"account_id"`
	AccountName      string    `json:"account_name"`
	MovementLineSide string    `json:"movement_line_side"`
	CcEnabled        bool      `json:"cc_enabled"`
	CreatedAt        time.Time `json:"created_at"`
}

type PendingDetail struct {
	ID                   string
	MovementLineID       string
	MovementID           string
	Type                 string
	Status               string
	ClientID             string
	CurrencyID           string
	Amount               string
	CcEnabled            bool
	ResolutionMode       *string
	ResolvedByMovementID *string
	MovementLineSide      string
	MovementLineAccountID string
}

func (r *PendingRepo) ListOpen(ctx context.Context) ([]PendingListItem, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT pi.id::text, pi.movement_line_id::text, ml.movement_id::text,
		        m.operation_number, m.type, pi.type, pi.status,
		        pi.client_id::text,
		        cl.last_name || ', ' || cl.first_name,
		        cl.address_street, cl.address_number, cl.address_floor,
		        cl.phone,
		        pi.currency_id::text, cu.code,
		        pi.amount::text,
		        ml.account_id::text,
		        a.name,
		        ml.side,
		        cl.cc_enabled,
		        pi.created_at
		 FROM pending_items pi
		 JOIN movement_lines ml ON ml.id = pi.movement_line_id
		 JOIN movements m ON m.id = ml.movement_id
		 JOIN clients cl ON cl.id = pi.client_id
		 JOIN currencies cu ON cu.id = pi.currency_id
		 JOIN accounts a ON a.id = ml.account_id
		 WHERE pi.status = 'ABIERTO'
		 ORDER BY pi.created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []PendingListItem
	for rows.Next() {
		var item PendingListItem
		if err := rows.Scan(
			&item.ID, &item.MovementLineID, &item.MovementID,
			&item.OperationNumber, &item.MovementType, &item.Type, &item.Status,
			&item.ClientID, &item.ClientName,
			&item.AddressStreet, &item.AddressNumber, &item.AddressFloor,
			&item.Phone,
			&item.CurrencyID, &item.CurrencyCode,
			&item.Amount, &item.AccountID, &item.AccountName,
			&item.MovementLineSide,
			&item.CcEnabled, &item.CreatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PendingRepo) FindByID(ctx context.Context, id string) (*PendingDetail, error) {
	var p PendingDetail
	err := r.pool.QueryRow(ctx,
		`SELECT pi.id::text, pi.movement_line_id::text, ml.movement_id::text,
		        pi.type, pi.status, pi.client_id::text,
		        pi.currency_id::text, pi.amount::text,
		        cl.cc_enabled,
		        pi.resolution_mode,
		        pi.resolved_by_movement_id::text,
		        ml.side,
		        ml.account_id::text
		 FROM pending_items pi
		 JOIN movement_lines ml ON ml.id = pi.movement_line_id
		 JOIN clients cl ON cl.id = pi.client_id
		 WHERE pi.id = $1`, id).
		Scan(&p.ID, &p.MovementLineID, &p.MovementID,
			&p.Type, &p.Status, &p.ClientID,
			&p.CurrencyID, &p.Amount, &p.CcEnabled,
			&p.ResolutionMode, &p.ResolvedByMovementID,
			&p.MovementLineSide, &p.MovementLineAccountID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &p, nil
}

func (r *PendingRepo) MarkResolvedWithMode(ctx context.Context, tx pgx.Tx, id, userID, mode string, resolvedByMovementID, resolutionNote *string) error {
	_, err := tx.Exec(ctx,
		`UPDATE pending_items
		    SET status = 'RESUELTO',
		        resolved_at = now(),
		        resolved_by_user_id = $2,
		        resolution_mode = $3,
		        resolved_by_movement_id = $4,
		        resolution_note = $5
		 WHERE id = $1`, id, userID, mode, resolvedByMovementID, resolutionNote)
	return err
}

func (r *PendingRepo) ReduceAmount(ctx context.Context, tx pgx.Tx, id, reduceBy string) error {
	_, err := tx.Exec(ctx,
		`UPDATE pending_items SET amount = amount - $2::numeric
		 WHERE id = $1`, id, reduceBy)
	return err
}

func (r *PendingRepo) MarkCancelled(ctx context.Context, tx pgx.Tx, id, userID string) error {
	_, err := tx.Exec(ctx,
		`UPDATE pending_items SET status = 'CANCELADO', resolved_at = now(), resolved_by_user_id = $2
		 WHERE id = $1`, id, userID)
	return err
}

func (r *PendingRepo) InsertMovementLine(ctx context.Context, tx pgx.Tx, movementID, side, accountID, currencyID, format, amount string) (string, error) {
	var id string
	err := tx.QueryRow(ctx,
		`INSERT INTO movement_lines (movement_id, side, account_id, currency_id, format, amount, is_pending)
		 VALUES ($1, $2, $3, $4, $5, $6::numeric, false)
		 RETURNING id::text`,
		movementID, side, accountID, currencyID, format, amount).Scan(&id)
	return id, err
}
