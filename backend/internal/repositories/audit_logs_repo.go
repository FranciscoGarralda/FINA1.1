package repositories

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type AuditLog struct {
	ID         string    `json:"id"`
	EntityType string    `json:"entity_type"`
	EntityID   *string   `json:"entity_id"`
	Action     string    `json:"action"`
	UserID     string    `json:"user_id"`
	Username   string    `json:"username"`
	CreatedAt  time.Time `json:"created_at"`
}

type AuditFilter struct {
	From       string
	To         string
	UserID     string
	EntityType string
	Action     string
	Page       int
	Limit      int
}

type AuditLogsRepo struct {
	pool *pgxpool.Pool
}

func NewAuditLogsRepo(pool *pgxpool.Pool) *AuditLogsRepo {
	return &AuditLogsRepo{pool: pool}
}

func (r *AuditLogsRepo) List(ctx context.Context, f AuditFilter) ([]AuditLog, int, error) {
	where := "WHERE 1=1"
	args := []interface{}{}
	idx := 1

	if f.From != "" {
		where += ` AND al.created_at::date >= $` + itoa(idx) + `::date`
		args = append(args, f.From)
		idx++
	}
	if f.To != "" {
		where += ` AND al.created_at::date <= $` + itoa(idx) + `::date`
		args = append(args, f.To)
		idx++
	}
	if f.UserID != "" {
		where += ` AND al.user_id = $` + itoa(idx) + `::uuid`
		args = append(args, f.UserID)
		idx++
	}
	if f.EntityType != "" {
		where += ` AND al.entity_type = $` + itoa(idx)
		args = append(args, f.EntityType)
		idx++
	}
	if f.Action != "" {
		where += ` AND al.action = $` + itoa(idx)
		args = append(args, f.Action)
		idx++
	}

	countQuery := `SELECT COUNT(*) FROM audit_logs al ` + where
	var total int
	if err := r.pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	if f.Limit <= 0 {
		f.Limit = 20
	}
	if f.Page <= 0 {
		f.Page = 1
	}
	offset := (f.Page - 1) * f.Limit

	dataQuery := `SELECT al.id::text, al.entity_type, al.entity_id::text, al.action,
	                     al.user_id::text, COALESCE(u.username, '—'), al.created_at
	              FROM audit_logs al
	              LEFT JOIN users u ON u.id = al.user_id
	              ` + where + `
	              ORDER BY al.created_at DESC
	              LIMIT $` + itoa(idx) + ` OFFSET $` + itoa(idx+1)
	args = append(args, f.Limit, offset)

	rows, err := r.pool.Query(ctx, dataQuery, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var logs []AuditLog
	for rows.Next() {
		var l AuditLog
		if err := rows.Scan(&l.ID, &l.EntityType, &l.EntityID, &l.Action, &l.UserID, &l.Username, &l.CreatedAt); err != nil {
			return nil, 0, err
		}
		logs = append(logs, l)
	}
	return logs, total, nil
}

func itoa(n int) string {
	s := ""
	if n == 0 {
		return "0"
	}
	for n > 0 {
		s = string(rune('0'+n%10)) + s
		n /= 10
	}
	return s
}
