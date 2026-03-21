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

type MovementRepo struct {
	pool *pgxpool.Pool
}

func NewMovementRepo(pool *pgxpool.Pool) *MovementRepo {
	return &MovementRepo{pool: pool}
}

type MovementListRow struct {
	ID              string    `json:"id"`
	OperationNumber int64     `json:"operation_number"`
	Type            string    `json:"type"`
	Date            string    `json:"date"`
	Status          string    `json:"status"`
	ClientName      *string   `json:"client_name"`
	CreatedAt       time.Time `json:"created_at"`
}

type MovementLineSummary struct {
	MovementID   string `json:"movement_id"`
	Side         string `json:"side"`
	CurrencyCode string `json:"currency_code"`
	Total        string `json:"total"`
}

type MovementPendingFlag struct {
	MovementID string `json:"movement_id"`
}

type MovementDetailRow struct {
	ID              string    `json:"id"`
	OperationNumber int64     `json:"operation_number"`
	Type            string    `json:"type"`
	Date            string    `json:"date"`
	DayName         string    `json:"day_name"`
	Status          string    `json:"status"`
	ClientID        *string   `json:"client_id"`
	ClientName      *string   `json:"client_name"`
	Note            *string   `json:"note"`
	CreatedAt       time.Time `json:"created_at"`
}

type MovementLineDetail struct {
	ID            string  `json:"id"`
	Side          string  `json:"side"`
	AccountName   string  `json:"account_name"`
	CurrencyCode  string  `json:"currency_code"`
	Format        string  `json:"format"`
	Amount        string  `json:"amount"`
	IsPending     bool    `json:"is_pending"`
	PendingStatus *string `json:"pending_status"`
}

type ListMovementsFilter struct {
	Page       int
	Limit      int
	DateFrom   string
	DateTo     string
	Type       string
	ClientName string
	SortBy     string
	SortDir    string
}

type ListDraftsFilter struct {
	Page     int
	Limit    int
	DateFrom string
	DateTo   string
	Type     string
	ClientID string
}

type MovementDraftListRow struct {
	ID              string    `json:"id"`
	OperationNumber int64     `json:"operation_number"`
	Type            string    `json:"type"`
	Date            string    `json:"date"`
	ClientID        *string   `json:"client_id"`
	ClientName      *string   `json:"client_name"`
	UpdatedAt       time.Time `json:"updated_at"`
}

func (r *MovementRepo) ListPaginated(ctx context.Context, f ListMovementsFilter) ([]MovementListRow, int, error) {
	where := []string{"m.status IN ('CONFIRMADA','CANCELADA')"}
	args := []interface{}{}
	idx := 1

	if f.DateFrom != "" {
		where = append(where, fmt.Sprintf("m.date >= $%d", idx))
		args = append(args, f.DateFrom)
		idx++
	}
	if f.DateTo != "" {
		where = append(where, fmt.Sprintf("m.date <= $%d", idx))
		args = append(args, f.DateTo)
		idx++
	}
	if f.Type != "" {
		where = append(where, fmt.Sprintf("m.type = $%d", idx))
		args = append(args, f.Type)
		idx++
	}
	if f.ClientName != "" {
		where = append(where, fmt.Sprintf("(cl.first_name || ' ' || cl.last_name) ILIKE '%%' || $%d || '%%'", idx))
		args = append(args, f.ClientName)
		idx++
	}

	whereClause := strings.Join(where, " AND ")

	orderCol := "m.created_at"
	orderDir := "DESC"
	switch f.SortBy {
	case "date":
		orderCol = "m.date"
	case "operation_number":
		orderCol = "m.operation_number"
	}
	if f.SortDir == "asc" {
		orderDir = "ASC"
	}

	countQuery := fmt.Sprintf(
		`SELECT count(*) FROM movements m LEFT JOIN clients cl ON cl.id = m.client_id WHERE %s`, whereClause)
	var total int
	if err := r.pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	offset := (f.Page - 1) * f.Limit
	dataQuery := fmt.Sprintf(
		`SELECT m.id::text, m.operation_number, m.type, m.date::text, m.status,
		        CASE WHEN m.client_id IS NOT NULL THEN cl.last_name || ', ' || cl.first_name ELSE NULL END,
		        m.created_at
		 FROM movements m
		 LEFT JOIN clients cl ON cl.id = m.client_id
		 WHERE %s
		 ORDER BY %s %s
		 LIMIT %d OFFSET %d`,
		whereClause, orderCol, orderDir, f.Limit, offset)

	rows, err := r.pool.Query(ctx, dataQuery, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var items []MovementListRow
	for rows.Next() {
		var item MovementListRow
		if err := rows.Scan(&item.ID, &item.OperationNumber, &item.Type, &item.Date,
			&item.Status, &item.ClientName, &item.CreatedAt); err != nil {
			return nil, 0, err
		}
		items = append(items, item)
	}
	return items, total, rows.Err()
}

func (r *MovementRepo) ListDraftsPaginated(ctx context.Context, f ListDraftsFilter) ([]MovementDraftListRow, int, error) {
	where := []string{"m.status = 'BORRADOR'"}
	args := []interface{}{}
	idx := 1

	if f.DateFrom != "" {
		where = append(where, fmt.Sprintf("m.date >= $%d", idx))
		args = append(args, f.DateFrom)
		idx++
	}
	if f.DateTo != "" {
		where = append(where, fmt.Sprintf("m.date <= $%d", idx))
		args = append(args, f.DateTo)
		idx++
	}
	if f.Type != "" {
		where = append(where, fmt.Sprintf("m.type = $%d", idx))
		args = append(args, f.Type)
		idx++
	}
	if f.ClientID != "" {
		where = append(where, fmt.Sprintf("m.client_id::text = $%d", idx))
		args = append(args, f.ClientID)
		idx++
	}

	whereClause := strings.Join(where, " AND ")
	countQuery := fmt.Sprintf(
		`SELECT count(*)
		 FROM movements m
		 WHERE %s`, whereClause)

	var total int
	if err := r.pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	offset := (f.Page - 1) * f.Limit
	dataQuery := fmt.Sprintf(
		`SELECT m.id::text, m.operation_number, m.type, m.date::text, m.client_id::text,
		        CASE WHEN m.client_id IS NOT NULL THEN cl.last_name || ', ' || cl.first_name ELSE NULL END,
		        COALESCE(md.updated_at, m.updated_at)
		 FROM movements m
		 LEFT JOIN movement_drafts md ON md.movement_id = m.id
		 LEFT JOIN clients cl ON cl.id = m.client_id
		 WHERE %s
		 ORDER BY COALESCE(md.updated_at, m.updated_at) DESC, m.operation_number DESC
		 LIMIT %d OFFSET %d`,
		whereClause, f.Limit, offset)

	rows, err := r.pool.Query(ctx, dataQuery, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var items []MovementDraftListRow
	for rows.Next() {
		var item MovementDraftListRow
		if err := rows.Scan(&item.ID, &item.OperationNumber, &item.Type, &item.Date, &item.ClientID, &item.ClientName, &item.UpdatedAt); err != nil {
			return nil, 0, err
		}
		items = append(items, item)
	}
	return items, total, rows.Err()
}

// ListLineSummaries returns aggregated IN/OUT totals per currency for the given movement IDs.
func (r *MovementRepo) ListLineSummaries(ctx context.Context, movementIDs []string) ([]MovementLineSummary, error) {
	if len(movementIDs) == 0 {
		return nil, nil
	}

	placeholders := make([]string, len(movementIDs))
	args := make([]interface{}, len(movementIDs))
	for i, id := range movementIDs {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = id
	}

	query := fmt.Sprintf(
		`SELECT ml.movement_id::text, ml.side, c.code, sum(ml.amount)::text
		 FROM movement_lines ml
		 JOIN currencies c ON c.id = ml.currency_id
		 WHERE ml.movement_id::text IN (%s)
		 GROUP BY ml.movement_id, ml.side, c.code
		 ORDER BY ml.side, c.code`,
		strings.Join(placeholders, ","))

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []MovementLineSummary
	for rows.Next() {
		var item MovementLineSummary
		if err := rows.Scan(&item.MovementID, &item.Side, &item.CurrencyCode, &item.Total); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// ListPendingFlags returns movement IDs that have at least one open pending item.
func (r *MovementRepo) ListPendingFlags(ctx context.Context, movementIDs []string) ([]string, error) {
	if len(movementIDs) == 0 {
		return nil, nil
	}

	placeholders := make([]string, len(movementIDs))
	args := make([]interface{}, len(movementIDs))
	for i, id := range movementIDs {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = id
	}

	query := fmt.Sprintf(
		`SELECT DISTINCT ml.movement_id::text
		 FROM pending_items pi
		 JOIN movement_lines ml ON ml.id = pi.movement_line_id
		 WHERE pi.status = 'ABIERTO' AND ml.movement_id::text IN (%s)`,
		strings.Join(placeholders, ","))

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (r *MovementRepo) FindByID(ctx context.Context, id string) (*MovementDetailRow, error) {
	var m MovementDetailRow
	err := r.pool.QueryRow(ctx,
		`SELECT m.id::text, m.operation_number, m.type, m.date::text, m.day_name, m.status,
		        m.client_id::text,
		        CASE WHEN m.client_id IS NOT NULL THEN cl.last_name || ', ' || cl.first_name ELSE NULL END,
		        m.note, m.created_at
		 FROM movements m
		 LEFT JOIN clients cl ON cl.id = m.client_id
		 WHERE m.id = $1`, id).
		Scan(&m.ID, &m.OperationNumber, &m.Type, &m.Date, &m.DayName, &m.Status,
			&m.ClientID, &m.ClientName, &m.Note, &m.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &m, nil
}

func (r *MovementRepo) GetLines(ctx context.Context, movementID string) ([]MovementLineDetail, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT ml.id::text, ml.side, a.name, c.code, ml.format, ml.amount::text,
		        ml.is_pending,
		        pi.status
		 FROM movement_lines ml
		 JOIN accounts a ON a.id = ml.account_id
		 JOIN currencies c ON c.id = ml.currency_id
		 LEFT JOIN pending_items pi ON pi.movement_line_id = ml.id
		 WHERE ml.movement_id = $1
		 ORDER BY ml.side, ml.created_at`, movementID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []MovementLineDetail
	for rows.Next() {
		var item MovementLineDetail
		if err := rows.Scan(&item.ID, &item.Side, &item.AccountName, &item.CurrencyCode,
			&item.Format, &item.Amount, &item.IsPending, &item.PendingStatus); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
