package services

import (
	"context"

	"fina/internal/repositories"
)

type AuditLogsService struct {
	repo *repositories.AuditLogsRepo
}

func NewAuditLogsService(repo *repositories.AuditLogsRepo) *AuditLogsService {
	return &AuditLogsService{repo: repo}
}

type AuditLogsResponse struct {
	Items []repositories.AuditLog `json:"items"`
	Total int                     `json:"total"`
	Page  int                     `json:"page"`
	Limit int                     `json:"limit"`
}

func (s *AuditLogsService) List(ctx context.Context, f repositories.AuditFilter) (*AuditLogsResponse, error) {
	items, total, err := s.repo.List(ctx, f)
	if err != nil {
		return nil, err
	}
	if items == nil {
		items = []repositories.AuditLog{}
	}
	return &AuditLogsResponse{
		Items: items,
		Total: total,
		Page:  f.Page,
		Limit: f.Limit,
	}, nil
}
