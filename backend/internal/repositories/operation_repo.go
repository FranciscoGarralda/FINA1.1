package repositories

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type OperationRepo struct {
	pool *pgxpool.Pool
}

func NewOperationRepo(pool *pgxpool.Pool) *OperationRepo {
	return &OperationRepo{pool: pool}
}

type MovementHeader struct {
	ID              string `json:"id"`
	OperationNumber int64  `json:"operation_number"`
}

type MovementMeta struct {
	ID              string
	Type            string
	Date            string
	DayName         string
	Status          string
	ClientID        *string
	OperationNumber int64
}

type MovementLineRow struct {
	ID         string
	Side       string
	AccountID  string
	CurrencyID string
	Format     string
	Amount     string
	IsPending  bool
}

type MovementCCEntryRow struct {
	ClientID   string
	CurrencyID string
	Amount     string
	Note       *string
}

type MovementProfitEntryRow struct {
	CurrencyID string
	Amount     string
	AccountID  string
	Format     string
}

type MovementCorrectionRow struct {
	SourceMovementID string
	DraftMovementID  string
	Mode             string
	Status           string
}

func (r *OperationRepo) CreateMovementHeader(ctx context.Context, tx pgx.Tx, movType, date, dayName string, clientID *string, createdByUserID string) (*MovementHeader, error) {
	var h MovementHeader
	err := tx.QueryRow(ctx,
		`INSERT INTO movements (type, date, day_name, client_id, created_by_user_id, status)
		 VALUES ($1, $2::date, $3, $4, $5, 'BORRADOR')
		 RETURNING id::text, operation_number`,
		movType, date, dayName, clientID, createdByUserID).
		Scan(&h.ID, &h.OperationNumber)
	if err != nil {
		return nil, err
	}
	return &h, nil
}

func (r *OperationRepo) GetMovementMetaTx(ctx context.Context, tx pgx.Tx, movementID string) (*MovementMeta, error) {
	var m MovementMeta
	err := tx.QueryRow(ctx,
		`SELECT id::text, type, date::text, day_name, status, client_id::text, operation_number
		 FROM movements
		 WHERE id = $1`, movementID).
		Scan(&m.ID, &m.Type, &m.Date, &m.DayName, &m.Status, &m.ClientID, &m.OperationNumber)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &m, nil
}

func (r *OperationRepo) UpdateMovementNoteTx(ctx context.Context, tx pgx.Tx, movementID string, note *string) error {
	var v interface{}
	if note != nil {
		t := strings.TrimSpace(*note)
		if t != "" {
			v = t
		}
	}
	_, err := tx.Exec(ctx,
		`UPDATE movements SET note = $2, updated_at = now() WHERE id = $1::uuid`,
		movementID, v)
	return err
}

func (r *OperationRepo) TransitionMovementStatusTx(ctx context.Context, tx pgx.Tx, movementID, fromStatus, toStatus string) (bool, error) {
	cmd, err := tx.Exec(ctx,
		`UPDATE movements
		 SET status = $2, updated_at = now()
		 WHERE id = $1 AND status = $3`,
		movementID, toStatus, fromStatus)
	if err != nil {
		return false, err
	}
	return cmd.RowsAffected() > 0, nil
}

func (r *OperationRepo) ListMovementLinesTx(ctx context.Context, tx pgx.Tx, movementID string) ([]MovementLineRow, error) {
	rows, err := tx.Query(ctx,
		`SELECT id::text, side, account_id::text, currency_id::text, format, amount::text, is_pending
		 FROM movement_lines
		 WHERE movement_id = $1
		 ORDER BY created_at, id`, movementID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []MovementLineRow
	for rows.Next() {
		var row MovementLineRow
		if err := rows.Scan(&row.ID, &row.Side, &row.AccountID, &row.CurrencyID, &row.Format, &row.Amount, &row.IsPending); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func (r *OperationRepo) ListMovementCCEntriesTx(ctx context.Context, tx pgx.Tx, movementID string) ([]MovementCCEntryRow, error) {
	rows, err := tx.Query(ctx,
		`SELECT client_id::text, currency_id::text, amount::text, note
		 FROM cc_entries
		 WHERE movement_id = $1
		 ORDER BY created_at, id`, movementID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []MovementCCEntryRow
	for rows.Next() {
		var row MovementCCEntryRow
		if err := rows.Scan(&row.ClientID, &row.CurrencyID, &row.Amount, &row.Note); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func (r *OperationRepo) ListMovementProfitEntriesTx(ctx context.Context, tx pgx.Tx, movementID string) ([]MovementProfitEntryRow, error) {
	rows, err := tx.Query(ctx,
		`SELECT currency_id::text, amount::text, account_id::text, format
		 FROM profit_entries
		 WHERE movement_id = $1
		 ORDER BY created_at, id`, movementID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []MovementProfitEntryRow
	for rows.Next() {
		var row MovementProfitEntryRow
		if err := rows.Scan(&row.CurrencyID, &row.Amount, &row.AccountID, &row.Format); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func (r *OperationRepo) CancelPendingItemsByMovementTx(ctx context.Context, tx pgx.Tx, movementID, userID string) (int64, error) {
	cmd, err := tx.Exec(ctx,
		`UPDATE pending_items pi
		 SET status = 'CANCELADO', resolved_at = now(), resolved_by_user_id = $2
		 FROM movement_lines ml
		 WHERE pi.movement_line_id = ml.id
		   AND ml.movement_id = $1
		   AND pi.status <> 'CANCELADO'`,
		movementID, userID)
	if err != nil {
		return 0, err
	}
	return cmd.RowsAffected(), nil
}

func ReverseSide(side string) (string, error) {
	switch side {
	case "IN":
		return "OUT", nil
	case "OUT":
		return "IN", nil
	default:
		return "", fmt.Errorf("invalid side: %s", side)
	}
}

func (r *OperationRepo) UpdateMovementHeaderTx(ctx context.Context, tx pgx.Tx, movementID, movType, date, dayName string, clientID *string) error {
	tag, err := tx.Exec(ctx,
		`UPDATE movements
		 SET type = $2, date = $3::date, day_name = $4, client_id = $5, updated_at = now()
		 WHERE id = $1 AND status = 'BORRADOR'`,
		movementID, movType, date, dayName, clientID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *OperationRepo) DeleteMovementDraftTx(ctx context.Context, tx pgx.Tx, movementID string) error {
	_, err := tx.Exec(ctx, `DELETE FROM movement_drafts WHERE movement_id = $1`, movementID)
	return err
}

func (r *OperationRepo) TransitionMovementStatus(ctx context.Context, movementID, fromStatus, toStatus string) (bool, error) {
	cmd, err := r.pool.Exec(ctx,
		`UPDATE movements
		 SET status = $2, updated_at = now()
		 WHERE id = $1 AND status = $3`,
		movementID, toStatus, fromStatus)
	if err != nil {
		return false, err
	}
	return cmd.RowsAffected() > 0, nil
}

func (r *OperationRepo) DeleteMovementByID(ctx context.Context, movementID string) (bool, error) {
	cmd, err := r.pool.Exec(ctx, `DELETE FROM movements WHERE id = $1`, movementID)
	if err != nil {
		return false, err
	}
	return cmd.RowsAffected() > 0, nil
}

func (r *OperationRepo) DeleteMovementByIDTx(ctx context.Context, tx pgx.Tx, movementID string) (bool, error) {
	cmd, err := tx.Exec(ctx, `DELETE FROM movements WHERE id = $1`, movementID)
	if err != nil {
		return false, err
	}
	return cmd.RowsAffected() > 0, nil
}

func (r *OperationRepo) UpsertMovementDraft(ctx context.Context, movementID string, payload string, updatedByUserID string) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO movement_drafts (movement_id, payload, updated_at, updated_by_user_id)
		 VALUES ($1, $2::jsonb, now(), $3)
		 ON CONFLICT (movement_id)
		 DO UPDATE SET payload = EXCLUDED.payload, updated_at = now(), updated_by_user_id = EXCLUDED.updated_by_user_id`,
		movementID, payload, updatedByUserID)
	return err
}

func (r *OperationRepo) UpsertMovementDraftTx(ctx context.Context, tx pgx.Tx, movementID string, payload string, updatedByUserID string) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO movement_drafts (movement_id, payload, updated_at, updated_by_user_id)
		 VALUES ($1, $2::jsonb, now(), $3)
		 ON CONFLICT (movement_id)
		 DO UPDATE SET payload = EXCLUDED.payload, updated_at = now(), updated_by_user_id = EXCLUDED.updated_by_user_id`,
		movementID, payload, updatedByUserID)
	return err
}

type MovementDraftRow struct {
	MovementID string
	Payload    string
	UpdatedAt  time.Time
}

func (r *OperationRepo) GetMovementDraft(ctx context.Context, movementID string) (*MovementDraftRow, error) {
	var row MovementDraftRow
	err := r.pool.QueryRow(ctx,
		`SELECT movement_id::text, payload::text, updated_at
		 FROM movement_drafts
		 WHERE movement_id = $1`, movementID).
		Scan(&row.MovementID, &row.Payload, &row.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &row, nil
}

func (r *OperationRepo) GetMovementDraftPayloadTx(ctx context.Context, tx pgx.Tx, movementID string) (*string, error) {
	var payload string
	err := tx.QueryRow(ctx,
		`SELECT payload::text
		 FROM movement_drafts
		 WHERE movement_id = $1`, movementID).
		Scan(&payload)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &payload, nil
}

func (r *OperationRepo) CreateMovementCorrectionTx(ctx context.Context, tx pgx.Tx, sourceMovementID, draftMovementID, mode, createdByUserID string) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO movement_corrections (source_movement_id, draft_movement_id, mode, status, created_by_user_id)
		 VALUES ($1, $2, $3, 'PENDING', $4)`,
		sourceMovementID, draftMovementID, mode, createdByUserID)
	return err
}

func (r *OperationRepo) GetMovementCorrectionByDraftTx(ctx context.Context, tx pgx.Tx, draftMovementID string) (*MovementCorrectionRow, error) {
	var row MovementCorrectionRow
	err := tx.QueryRow(ctx,
		`SELECT source_movement_id::text, draft_movement_id::text, mode, status
		 FROM movement_corrections
		 WHERE draft_movement_id = $1
		 FOR UPDATE`,
		draftMovementID).Scan(&row.SourceMovementID, &row.DraftMovementID, &row.Mode, &row.Status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}

func (r *OperationRepo) MarkMovementCorrectionAppliedTx(ctx context.Context, tx pgx.Tx, draftMovementID string) error {
	_, err := tx.Exec(ctx,
		`UPDATE movement_corrections
		 SET status = 'APPLIED', applied_at = now()
		 WHERE draft_movement_id = $1 AND status = 'PENDING'`,
		draftMovementID)
	return err
}

func (r *OperationRepo) InsertMovementLine(ctx context.Context, tx pgx.Tx, movementID, side, accountID, currencyID, format, amount string, isPending bool) (string, error) {
	var id string
	err := tx.QueryRow(ctx,
		`INSERT INTO movement_lines (movement_id, side, account_id, currency_id, format, amount, is_pending)
		 VALUES ($1, $2, $3, $4, $5, $6::numeric, $7)
		 RETURNING id::text`,
		movementID, side, accountID, currencyID, format, amount, isPending).Scan(&id)
	return id, err
}

func (r *OperationRepo) InsertPendingItem(ctx context.Context, tx pgx.Tx, movementLineID, pendingType, clientID, currencyID, amount string) (string, error) {
	var id string
	err := tx.QueryRow(ctx,
		`INSERT INTO pending_items (movement_line_id, type, status, client_id, currency_id, amount)
		 VALUES ($1, $2, 'ABIERTO', $3, $4, $5::numeric)
		 RETURNING id::text`,
		movementLineID, pendingType, clientID, currencyID, amount).Scan(&id)
	return id, err
}

func (r *OperationRepo) InsertProfitEntry(ctx context.Context, tx pgx.Tx, movementID, currencyID, amount, accountID, format string) (string, error) {
	var id string
	err := tx.QueryRow(ctx,
		`INSERT INTO profit_entries (movement_id, currency_id, amount, account_id, format)
		 VALUES ($1, $2, $3::numeric, $4, $5)
		 RETURNING id::text`,
		movementID, currencyID, amount, accountID, format).Scan(&id)
	return id, err
}

func (r *OperationRepo) ValidateAccountCurrencyFormat(ctx context.Context, accountID, currencyID, format string) error {
	var cashEnabled, digitalEnabled bool
	err := r.pool.QueryRow(ctx,
		`SELECT ac.cash_enabled, ac.digital_enabled
		 FROM account_currencies ac
		 JOIN accounts a ON a.id = ac.account_id
		 JOIN currencies c ON c.id = ac.currency_id
		 WHERE ac.account_id = $1 AND ac.currency_id = $2
		   AND a.active = true AND c.active = true`,
		accountID, currencyID).Scan(&cashEnabled, &digitalEnabled)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrCurrencyNotEnabled
		}
		return err
	}

	if format == "CASH" && !cashEnabled {
		return ErrFormatNotAllowed
	}
	if format == "DIGITAL" && !digitalEnabled {
		return ErrFormatNotAllowed
	}
	return nil
}

func (r *OperationRepo) ValidateClientActive(ctx context.Context, clientID string) error {
	var active bool
	err := r.pool.QueryRow(ctx, `SELECT active FROM clients WHERE id = $1`, clientID).Scan(&active)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if !active {
		return ErrClientInactive
	}
	return nil
}

var (
	ErrCurrencyNotEnabled = errors.New("CURRENCY_NOT_ENABLED")
	ErrFormatNotAllowed   = errors.New("FORMAT_NOT_ALLOWED")
	ErrClientInactive     = errors.New("CLIENT_INACTIVE")
)
