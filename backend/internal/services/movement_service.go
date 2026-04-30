package services

import (
	"context"
	"fmt"
	"strings"

	"fina/internal/repositories"
)

type MovementService struct {
	movementRepo *repositories.MovementRepo
}

func NewMovementService(movementRepo *repositories.MovementRepo) *MovementService {
	return &MovementService{movementRepo: movementRepo}
}

type MovementSummaryItem struct {
	Side         string `json:"side"`
	CurrencyCode string `json:"currency_code"`
	Amount       string `json:"amount"`
}

type MovementListItem struct {
	ID              string                `json:"id"`
	OperationNumber int64                 `json:"operation_number"`
	Type            string                `json:"type"`
	Date            string                `json:"date"`
	Status          string                `json:"status"`
	ClientName      *string               `json:"client_name"`
	Resumen         string                `json:"resumen"`
	SummaryItems    []MovementSummaryItem `json:"summary_items,omitempty"`
	HasOpenPending  bool                  `json:"has_open_pending"`
	CreatedAt       string                `json:"created_at"`
}

type MovementListResult struct {
	Items []MovementListItem `json:"items"`
	Total int                `json:"total"`
	Page  int                `json:"page"`
	Limit int                `json:"limit"`
}

type MovementDraftListItem struct {
	ID              string  `json:"id"`
	OperationNumber int64   `json:"operation_number"`
	Type            string  `json:"type"`
	Date            string  `json:"date"`
	ClientID        *string `json:"client_id"`
	ClientName      *string `json:"client_name"`
	UpdatedAt       string  `json:"updated_at"`
}

type MovementDraftListResult struct {
	Items []MovementDraftListItem `json:"items"`
	Total int                     `json:"total"`
	Page  int                     `json:"page"`
	Limit int                     `json:"limit"`
}

func (s *MovementService) List(ctx context.Context, f repositories.ListMovementsFilter) (*MovementListResult, error) {
	rows, total, err := s.movementRepo.ListPaginated(ctx, f)
	if err != nil {
		return nil, err
	}

	movementIDs := make([]string, len(rows))
	for i, r := range rows {
		movementIDs[i] = r.ID
	}

	summaries, err := s.movementRepo.ListLineSummaries(ctx, movementIDs)
	if err != nil {
		return nil, err
	}
	summaryMap := make(map[string][]repositories.MovementLineSummary)
	for _, s := range summaries {
		summaryMap[s.MovementID] = append(summaryMap[s.MovementID], s)
	}

	pendingIDs, err := s.movementRepo.ListPendingFlags(ctx, movementIDs)
	if err != nil {
		return nil, err
	}
	pendingSet := make(map[string]bool)
	for _, id := range pendingIDs {
		pendingSet[id] = true
	}

	items := make([]MovementListItem, len(rows))
	for i, r := range rows {
		items[i] = MovementListItem{
			ID:              r.ID,
			OperationNumber: r.OperationNumber,
			Type:            r.Type,
			Date:            r.Date,
			Status:          r.Status,
			ClientName:      r.ClientName,
			Resumen:         buildResumen(summaryMap[r.ID]),
			SummaryItems:    buildSummaryItems(summaryMap[r.ID]),
			HasOpenPending:  pendingSet[r.ID],
			CreatedAt:       r.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		}
	}

	return &MovementListResult{
		Items: items,
		Total: total,
		Page:  f.Page,
		Limit: f.Limit,
	}, nil
}

func (s *MovementService) ListDrafts(ctx context.Context, f repositories.ListDraftsFilter) (*MovementDraftListResult, error) {
	rows, total, err := s.movementRepo.ListDraftsPaginated(ctx, f)
	if err != nil {
		return nil, err
	}

	items := make([]MovementDraftListItem, len(rows))
	for i, r := range rows {
		items[i] = MovementDraftListItem{
			ID:              r.ID,
			OperationNumber: r.OperationNumber,
			Type:            r.Type,
			Date:            r.Date,
			ClientID:        r.ClientID,
			ClientName:      r.ClientName,
			UpdatedAt:       r.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
		}
	}

	return &MovementDraftListResult{
		Items: items,
		Total: total,
		Page:  f.Page,
		Limit: f.Limit,
	}, nil
}

type MovementDetail struct {
	ID                       string                            `json:"id"`
	OperationNumber          int64                             `json:"operation_number"`
	Type                     string                            `json:"type"`
	Date                     string                            `json:"date"`
	DayName                  string                            `json:"day_name"`
	Status                   string                            `json:"status"`
	ClientID                 *string                           `json:"client_id"`
	ClientName               *string                           `json:"client_name"`
	ArbitrajeCostClientID    *string                           `json:"arbitraje_cost_client_id"`
	ArbitrajeCobradoClientID *string                           `json:"arbitraje_cobrado_client_id"`
	Note                     *string                           `json:"note"`
	CreatedAt                string                            `json:"created_at"`
	Lines                    []repositories.MovementLineDetail `json:"lines"`
}

func (s *MovementService) GetByID(ctx context.Context, id string) (*MovementDetail, error) {
	row, err := s.movementRepo.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}

	lines, err := s.movementRepo.GetLines(ctx, id)
	if err != nil {
		return nil, err
	}
	if lines == nil {
		lines = []repositories.MovementLineDetail{}
	}

	return &MovementDetail{
		ID:                       row.ID,
		OperationNumber:          row.OperationNumber,
		Type:                     row.Type,
		Date:                     row.Date,
		DayName:                  row.DayName,
		Status:                   row.Status,
		ClientID:                 row.ClientID,
		ClientName:               row.ClientName,
		ArbitrajeCostClientID:    row.ArbitrajeCostClientID,
		ArbitrajeCobradoClientID: row.ArbitrajeCobradoClientID,
		Note:                     row.Note,
		CreatedAt:                row.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		Lines:                    lines,
	}, nil
}

func buildResumen(summaries []repositories.MovementLineSummary) string {
	if len(summaries) == 0 {
		return "—"
	}

	inParts := []string{}
	outParts := []string{}

	for _, s := range summaries {
		label := fmt.Sprintf("%s %s", s.CurrencyCode, s.Total)
		if s.Side == "IN" {
			inParts = append(inParts, label)
		} else {
			outParts = append(outParts, label)
		}
	}

	parts := []string{}
	if len(inParts) > 0 {
		parts = append(parts, "ENTRA: "+strings.Join(inParts, ", "))
	}
	if len(outParts) > 0 {
		parts = append(parts, "SALE: "+strings.Join(outParts, ", "))
	}

	return strings.Join(parts, " | ")
}

func buildSummaryItems(summaries []repositories.MovementLineSummary) []MovementSummaryItem {
	items := make([]MovementSummaryItem, 0, len(summaries))
	for _, s := range summaries {
		items = append(items, MovementSummaryItem{
			Side:         s.Side,
			CurrencyCode: s.CurrencyCode,
			Amount:       s.Total,
		})
	}
	return items
}
