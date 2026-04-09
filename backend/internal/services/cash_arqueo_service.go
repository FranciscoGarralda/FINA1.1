package services

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"fina/internal/models"
	"fina/internal/repositories"

	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrCashArqueoInvalidInput       = errors.New("datos de arqueo inválidos")
	ErrCashArqueoNoLines            = errors.New("al menos una línea por divisa")
	ErrCashArqueoDupLine            = errors.New("combinación divisa y formato repetida en el arqueo")
	ErrCashArqueoBadCurrency        = errors.New("divisa no habilitada en la cuenta")
	ErrCashArqueoBadFormat          = errors.New("formato inválido (use CASH o DIGITAL)")
	ErrCashArqueoFormatNotAllowed   = errors.New("formato no habilitado para esa divisa en la cuenta")
	ErrCashArqueoAccountMissing     = errors.New("cuenta no encontrada")
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
	Format       string `json:"format"`
	CountedTotal string `json:"counted_total"`
}

type CashArqueoCreateInput struct {
	AccountID  string                `json:"account_id"`
	ArqueoDate string                `json:"arqueo_date"`
	Note       *string               `json:"note"`
	Lines      []CashArqueoLineInput `json:"lines"`
}

type CashArqueoLineOut struct {
	CurrencyID            string `json:"currency_id"`
	CurrencyCode          string `json:"currency_code"`
	Format                string `json:"format"`
	SystemBalanceSnapshot string `json:"system_balance_snapshot"`
	CountedTotal          string `json:"counted_total"`
	Difference            string `json:"difference"`
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

func (s *CashArqueoService) SystemTotalsForAccount(ctx context.Context, accountID, asOfDate string) ([]repositories.AccountCurrencyFormatTotal, error) {
	if accountID == "" {
		return nil, ErrCashArqueoInvalidInput
	}
	if _, err := s.accountRepo.FindByID(ctx, accountID); err != nil {
		if errors.Is(err, repositories.ErrNotFound) {
			return nil, ErrCashArqueoAccountMissing
		}
		return nil, err
	}
	return s.cashPosRepo.ListAccountCurrencyFormatTotals(ctx, accountID, asOfDate)
}

func normalizeArqueoFormat(s string) (string, error) {
	f := strings.ToUpper(strings.TrimSpace(s))
	if f != "CASH" && f != "DIGITAL" {
		return "", ErrCashArqueoBadFormat
	}
	return f, nil
}

func arqueoLineKey(currencyID, format string) string {
	return currencyID + "\x00" + format
}

type parsedArqueoLine struct {
	CurrencyID   string
	Format       string
	CountedTotal string
}

func parseCashArqueoLines(in []CashArqueoLineInput) ([]parsedArqueoLine, error) {
	if len(in) == 0 {
		return nil, ErrCashArqueoNoLines
	}
	seen := map[string]bool{}
	out := make([]parsedArqueoLine, 0, len(in))
	for _, ln := range in {
		if ln.CurrencyID == "" {
			return nil, ErrCashArqueoInvalidInput
		}
		f, err := normalizeArqueoFormat(ln.Format)
		if err != nil {
			return nil, err
		}
		k := arqueoLineKey(ln.CurrencyID, f)
		if seen[k] {
			return nil, ErrCashArqueoDupLine
		}
		seen[k] = true
		if _, ok := new(big.Rat).SetString(ln.CountedTotal); !ok {
			return nil, ErrCashArqueoInvalidInput
		}
		out = append(out, parsedArqueoLine{CurrencyID: ln.CurrencyID, Format: f, CountedTotal: ln.CountedTotal})
	}
	return out, nil
}

func validateFormatsAgainstAccount(lines []parsedArqueoLine, acctCurrencies []models.AccountCurrencyItem) error {
	byCurr := map[string]models.AccountCurrencyItem{}
	for _, ac := range acctCurrencies {
		byCurr[ac.CurrencyID] = ac
	}
	for _, ln := range lines {
		ac, ok := byCurr[ln.CurrencyID]
		if !ok {
			return ErrCashArqueoBadCurrency
		}
		if ln.Format == "CASH" && !ac.CashEnabled {
			return ErrCashArqueoFormatNotAllowed
		}
		if ln.Format == "DIGITAL" && !ac.DigitalEnabled {
			return ErrCashArqueoFormatNotAllowed
		}
	}
	return nil
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
			Format:                row.LineFormat,
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

	parsed, err := parseCashArqueoLines(in.Lines)
	if err != nil {
		return nil, err
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
	if err := validateFormatsAgainstAccount(parsed, acctCurrencies); err != nil {
		return nil, err
	}

	totals, err := s.cashPosRepo.ListAccountCurrencyFormatTotals(ctx, in.AccountID, in.ArqueoDate)
	if err != nil {
		return nil, err
	}
	sysByKey := map[string]string{}
	codeByCurr := map[string]string{}
	for _, t := range totals {
		sysByKey[arqueoLineKey(t.CurrencyID, t.Format)] = t.Balance
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

	linesOut := make([]CashArqueoLineOut, 0, len(parsed))
	for _, ln := range parsed {
		k := arqueoLineKey(ln.CurrencyID, ln.Format)
		sys := sysByKey[k]
		if sys == "" {
			sys = "0"
		}
		if err := s.arqueoRepo.InsertLineTx(ctx, tx, arqueoID, ln.CurrencyID, ln.Format, sys, ln.CountedTotal); err != nil {
			return nil, err
		}
		diff, err := DifferenceCountedMinusSystem(ln.CountedTotal, sys)
		if err != nil {
			return nil, err
		}
		linesOut = append(linesOut, CashArqueoLineOut{
			CurrencyID:            ln.CurrencyID,
			CurrencyCode:          codeByCurr[ln.CurrencyID],
			Format:                ln.Format,
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
