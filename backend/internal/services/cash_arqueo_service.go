package services

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"fina/internal/repositories"

	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrCashArqueoInvalidInput    = errors.New("datos de arqueo inválidos")
	ErrCashArqueoNoLines       = errors.New("al menos una línea por divisa")
	ErrCashArqueoDupCurrency   = errors.New("divisa duplicada en el arqueo")
	ErrCashArqueoBadCurrency   = errors.New("divisa no habilitada en la cuenta")
	ErrCashArqueoAccountMissing = errors.New("cuenta no encontrada")
)

// DifferenceCountedMinusSystem conteo real − saldo sistema (texto decimal).
func DifferenceCountedMinusSystem(counted, system string) (string, error) {
	c := new(big.Rat)
	s := new(big.Rat)
	if _, ok := c.SetString(counted); !ok {
		return "", fmt.Errorf("%w: conteo", ErrCashArqueoInvalidInput)
	}
	if _, ok := s.SetString(system); !ok {
		return "", fmt.Errorf("%w: sistema", ErrCashArqueoInvalidInput)
	}
	d := new(big.Rat).Sub(c, s)
	return ratToMoneyString(d), nil
}

func ratToMoneyString(r *big.Rat) string {
	s := r.FloatString(8)
	s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	if s == "" || s == "-" {
		return "0"
	}
	return s
}

type CashArqueoLineInput struct {
	CurrencyID   string `json:"currency_id"`
	CountedTotal string `json:"counted_total"`
}

type CashArqueoCreateInput struct {
	AccountID  string                `json:"account_id"`
	ArqueoDate string                `json:"arqueo_date"`
	Note       *string               `json:"note"`
	Lines      []CashArqueoLineInput `json:"lines"`
}

type CashArqueoLineOut struct {
	CurrencyID           string `json:"currency_id"`
	CurrencyCode         string `json:"currency_code"`
	SystemBalanceSnapshot string `json:"system_balance_snapshot"`
	CountedTotal         string `json:"counted_total"`
	Difference           string `json:"difference"`
}

type CashArqueoSummary struct {
	ID                string              `json:"id"`
	AccountID         string              `json:"account_id"`
	AccountName       string              `json:"account_name"`
	ArqueoDate        string              `json:"arqueo_date"`
	Note              *string             `json:"note"`
	CreatedByUserID   string              `json:"created_by_user_id"`
	CreatedByUsername string              `json:"created_by_username"`
	CreatedAt         string              `json:"created_at"`
	Lines             []CashArqueoLineOut `json:"lines"`
}

type CashArqueoService struct {
	pool        *pgxpool.Pool
	arqueoRepo  *repositories.CashArqueoRepo
	cashPosRepo *repositories.CashPositionRepo
	accountRepo *repositories.AccountRepo
	auditRepo   *repositories.AuditRepo
}

func NewCashArqueoService(pool *pgxpool.Pool, arqueoRepo *repositories.CashArqueoRepo, cashPosRepo *repositories.CashPositionRepo, accountRepo *repositories.AccountRepo, auditRepo *repositories.AuditRepo) *CashArqueoService {
	return &CashArqueoService{
		pool:        pool,
		arqueoRepo:  arqueoRepo,
		cashPosRepo: cashPosRepo,
		accountRepo: accountRepo,
		auditRepo:   auditRepo,
	}
}

func (s *CashArqueoService) SystemTotalsForAccount(ctx context.Context, accountID, asOfDate string) ([]repositories.AccountCurrencyTotal, error) {
	if accountID == "" {
		return nil, ErrCashArqueoInvalidInput
	}
	if _, err := s.accountRepo.FindByID(ctx, accountID); err != nil {
		if errors.Is(err, repositories.ErrNotFound) {
			return nil, ErrCashArqueoAccountMissing
		}
		return nil, err
	}
	return s.cashPosRepo.ListAccountCurrencyTotals(ctx, accountID, asOfDate)
}

func (s *CashArqueoService) List(ctx context.Context, accountID, fromDate, toDate string) ([]CashArqueoSummary, error) {
	rows, err := s.arqueoRepo.List(ctx, accountID, fromDate, toDate)
	if err != nil {
		return nil, err
	}
	return groupArqueoRows(rows)
}

func groupArqueoRows(rows []repositories.CashArqueoListRow) ([]CashArqueoSummary, error) {
	order := []string{}
	byID := map[string]*CashArqueoSummary{}
	lineByArqueo := map[string][]CashArqueoLineOut{}

	for _, row := range rows {
		if _, ok := byID[row.ArqueoID]; !ok {
			byID[row.ArqueoID] = &CashArqueoSummary{
				ID:                row.ArqueoID,
				AccountID:         row.AccountID,
				AccountName:       row.AccountName,
				ArqueoDate:        row.ArqueoDate,
				Note:              row.Note,
				CreatedByUserID:   row.CreatedByID,
				CreatedByUsername: row.CreatedByName,
				CreatedAt:         row.CreatedAt,
			}
			order = append(order, row.ArqueoID)
		}
		diff, err := DifferenceCountedMinusSystem(row.CountedTotal, row.SystemSnapshot)
		if err != nil {
			return nil, err
		}
		lineByArqueo[row.ArqueoID] = append(lineByArqueo[row.ArqueoID], CashArqueoLineOut{
			CurrencyID:            row.CurrencyID,
			CurrencyCode:          row.CurrencyCode,
			SystemBalanceSnapshot: row.SystemSnapshot,
			CountedTotal:          row.CountedTotal,
			Difference:            diff,
		})
	}

	out := make([]CashArqueoSummary, 0, len(order))
	for _, id := range order {
		summary := byID[id]
		summary.Lines = lineByArqueo[id]
		out = append(out, *summary)
	}
	return out, nil
}

func (s *CashArqueoService) Create(ctx context.Context, in CashArqueoCreateInput, userID string) (*CashArqueoSummary, error) {
	if in.AccountID == "" || in.ArqueoDate == "" {
		return nil, ErrCashArqueoInvalidInput
	}
	if _, err := time.Parse("2006-01-02", in.ArqueoDate); err != nil {
		return nil, ErrCashArqueoInvalidInput
	}
	if len(in.Lines) == 0 {
		return nil, ErrCashArqueoNoLines
	}

	seen := map[string]bool{}
	for _, ln := range in.Lines {
		if ln.CurrencyID == "" {
			return nil, ErrCashArqueoInvalidInput
		}
		if seen[ln.CurrencyID] {
			return nil, ErrCashArqueoDupCurrency
		}
		seen[ln.CurrencyID] = true
		if _, ok := new(big.Rat).SetString(ln.CountedTotal); !ok {
			return nil, ErrCashArqueoInvalidInput
		}
	}

	if _, err := s.accountRepo.FindByID(ctx, in.AccountID); err != nil {
		if errors.Is(err, repositories.ErrNotFound) {
			return nil, ErrCashArqueoAccountMissing
		}
		return nil, err
	}

	acctCurrencies, err := s.accountRepo.GetAccountCurrencies(ctx, in.AccountID)
	if err != nil {
		return nil, err
	}
	allowed := map[string]bool{}
	for _, ac := range acctCurrencies {
		allowed[ac.CurrencyID] = true
	}
	for _, ln := range in.Lines {
		if !allowed[ln.CurrencyID] {
			return nil, ErrCashArqueoBadCurrency
		}
	}

	totals, err := s.cashPosRepo.ListAccountCurrencyTotals(ctx, in.AccountID, in.ArqueoDate)
	if err != nil {
		return nil, err
	}
	sysByCurr := map[string]string{}
	codeByCurr := map[string]string{}
	for _, t := range totals {
		sysByCurr[t.CurrencyID] = t.Balance
		codeByCurr[t.CurrencyID] = t.CurrencyCode
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	arqueoID, err := s.arqueoRepo.InsertArqueoTx(ctx, tx, in.AccountID, in.ArqueoDate, in.Note, userID)
	if err != nil {
		return nil, err
	}

	linesOut := make([]CashArqueoLineOut, 0, len(in.Lines))
	for _, ln := range in.Lines {
		sys := sysByCurr[ln.CurrencyID]
		if sys == "" {
			sys = "0"
		}
		if err := s.arqueoRepo.InsertLineTx(ctx, tx, arqueoID, ln.CurrencyID, sys, ln.CountedTotal); err != nil {
			return nil, err
		}
		diff, err := DifferenceCountedMinusSystem(ln.CountedTotal, sys)
		if err != nil {
			return nil, err
		}
		linesOut = append(linesOut, CashArqueoLineOut{
			CurrencyID:            ln.CurrencyID,
			CurrencyCode:          codeByCurr[ln.CurrencyID],
			SystemBalanceSnapshot: sys,
			CountedTotal:          ln.CountedTotal,
			Difference:            diff,
		})
	}

	acc, err := s.accountRepo.FindByID(ctx, in.AccountID)
	if err != nil {
		if errors.Is(err, repositories.ErrNotFound) {
			return nil, ErrCashArqueoAccountMissing
		}
		return nil, err
	}
	auditPayload := map[string]interface{}{
		"id":           arqueoID,
		"account_id":   in.AccountID,
		"arqueo_date":  in.ArqueoDate,
		"note":         in.Note,
		"lines":        linesOut,
		"account_name": acc.Name,
	}
	aid := arqueoID
	if err := s.auditRepo.InsertTx(ctx, tx, "cash_arqueo", &aid, "create", nil, auditPayload, userID); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return &CashArqueoSummary{
		ID:                arqueoID,
		AccountID:         in.AccountID,
		AccountName:       acc.Name,
		ArqueoDate:        in.ArqueoDate,
		Note:              in.Note,
		CreatedByUserID:   userID,
		CreatedByUsername: "",
		CreatedAt:         time.Now().UTC().Format(time.RFC3339),
		Lines:             linesOut,
	}, nil
}
