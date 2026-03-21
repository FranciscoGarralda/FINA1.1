package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strings"

	"fina/internal/repositories"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrClientCCNotEnabled          = errors.New("CLIENT_CC_NOT_ENABLED")
	ErrAmountsMustMatch            = errors.New("AMOUNTS_MUST_MATCH")
	ErrInvalidPagoCCMode           = errors.New("INVALID_PAGO_CC_MODE")
	ErrCCBalanceZeroNotCancellable = errors.New("CC_BALANCE_ZERO_NOT_CANCELLABLE")
	ErrCCOverpayNotAllowed         = errors.New("CC_OVERPAY_NOT_ALLOWED")
	ErrCCPositiveBalanceNotAllowed = errors.New("CC_POSITIVE_BALANCE_NOT_ALLOWED")
)

type PagoCCCruzadoService struct {
	pool          *pgxpool.Pool
	operationRepo *repositories.OperationRepo
	ccSvc         *CCService
	auditRepo     *repositories.AuditRepo
}

func NewPagoCCCruzadoService(pool *pgxpool.Pool, operationRepo *repositories.OperationRepo, ccSvc *CCService, auditRepo *repositories.AuditRepo) *PagoCCCruzadoService {
	return &PagoCCCruzadoService{pool: pool, operationRepo: operationRepo, ccSvc: ccSvc, auditRepo: auditRepo}
}

type PagoCCPaymentLeg struct {
	AccountID  string `json:"account_id"`
	CurrencyID string `json:"currency_id"`
	Format     string `json:"format"`
	Amount     string `json:"amount"`
}

type PagoCCCancelLeg struct {
	CurrencyID string `json:"currency_id"`
	Amount     string `json:"amount"`
}

type PagoCCCruzadoInput struct {
	Payment PagoCCPaymentLeg `json:"payment"`
	Cancel  PagoCCCancelLeg  `json:"cancel"`
	Mode    string           `json:"mode,omitempty"`
}

func (s *PagoCCCruzadoService) Execute(ctx context.Context, movementID string, input PagoCCCruzadoInput, callerID string) error {
	mode := normalizePagoCCMode(input.Mode)
	if mode == "" {
		return ErrInvalidPagoCCMode
	}

	payAmt, ok := new(big.Rat).SetString(input.Payment.Amount)
	if !ok || payAmt.Sign() <= 0 {
		return ErrInvalidAmount
	}
	cancelAmt, ok := new(big.Rat).SetString(input.Cancel.Amount)
	if !ok || cancelAmt.Sign() <= 0 {
		return ErrInvalidAmount
	}

	if input.Payment.Format != "CASH" && input.Payment.Format != "DIGITAL" {
		return ErrInvalidAmount
	}

	if err := s.operationRepo.ValidateAccountCurrencyFormat(ctx, input.Payment.AccountID, input.Payment.CurrencyID, input.Payment.Format); err != nil {
		return err
	}

	// Validate debt currency is active
	var debtCurrActive bool
	err := s.pool.QueryRow(ctx, `SELECT active FROM currencies WHERE id = $1`, input.Cancel.CurrencyID).Scan(&debtCurrActive)
	if err != nil {
		return ErrInvalidAmount
	}
	if !debtCurrActive {
		return repositories.ErrCurrencyNotEnabled
	}

	var movType, movStatus, clientID string
	var ccEnabled bool
	err = s.pool.QueryRow(ctx,
		`SELECT m.type, m.status, m.client_id::text, c.cc_enabled
		 FROM movements m
		 JOIN clients c ON c.id = m.client_id
		 WHERE m.id = $1`, movementID).
		Scan(&movType, &movStatus, &clientID, &ccEnabled)
	if err != nil {
		return ErrMovementNotFound
	}
	if movType != "PAGO_CC_CRUZADO" {
		return ErrMovementTypeMismatch
	}
	if movStatus != MovementStatusDraft {
		return ErrMovementNotDraft
	}
	if !ccEnabled {
		return ErrClientCCNotEnabled
	}

	sameCurrency := input.Payment.CurrencyID == input.Cancel.CurrencyID
	if sameCurrency {
		if payAmt.Cmp(cancelAmt) != 0 {
			return ErrAmountsMustMatch
		}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	currentCCBalance, err := s.getCCBalanceForUpdate(ctx, tx, clientID, input.Cancel.CurrencyID)
	if err != nil {
		return err
	}
	if currentCCBalance.Sign() == 0 {
		return ErrCCBalanceZeroNotCancellable
	}

	allowOverpay, err := s.getSettingBoolTx(ctx, tx, "cc_allow_overpay", true)
	if err != nil {
		return err
	}
	allowPositiveBalance, err := s.getSettingBoolTx(ctx, tx, "cc_allow_positive_balance", true)
	if err != nil {
		return err
	}

	ccSide := ccSideIn
	if currentCCBalance.Sign() > 0 {
		ccSide = ccSideOut
	}
	ccDelta := new(big.Rat).Set(cancelAmt)
	if ccSide == ccSideOut {
		ccDelta.Neg(ccDelta)
	}
	finalCCBalance := new(big.Rat).Add(currentCCBalance, ccDelta)
	if !allowOverpay && currentCCBalance.Sign()*finalCCBalance.Sign() < 0 {
		return ErrCCOverpayNotAllowed
	}
	if !allowPositiveBalance && finalCCBalance.Sign() > 0 {
		return ErrCCPositiveBalanceNotAllowed
	}

	realSide := "IN"
	if mode == "SALE" {
		realSide = "OUT"
	}

	// Real money movement line.
	_, err = s.operationRepo.InsertMovementLine(ctx, tx, movementID, realSide,
		input.Payment.AccountID, input.Payment.CurrencyID, input.Payment.Format,
		input.Payment.Amount, false)
	if err != nil {
		return fmt.Errorf("insert payment line: %w", err)
	}

	// CC impact inferred from live balance sign in cancel currency.
	ccNote := "Pago CC cruzado"
	err = applyCCImpactTx(ctx, s.ccSvc, tx, clientID, input.Cancel.CurrencyID, input.Cancel.Amount, movementID, ccSide, ccNote, callerID)
	if err != nil {
		return fmt.Errorf("apply cc_entry: %w", err)
	}

	if err := s.auditRepo.InsertTx(ctx, tx, "movement", &movementID, "pago_cc_cruzado",
		nil,
		map[string]interface{}{
			"mode":                      mode,
			"real_side":                 realSide,
			"payment_currency":          input.Payment.CurrencyID,
			"payment_amount":            input.Payment.Amount,
			"debt_currency":             input.Cancel.CurrencyID,
			"cancel_amount":             input.Cancel.Amount,
			"same_currency":             sameCurrency,
			"cc_side":                   ccSide,
			"cc_balance_before":         ratTrim(currentCCBalance),
			"cc_balance_after":          ratTrim(finalCCBalance),
			"cc_allow_overpay":          allowOverpay,
			"cc_allow_positive_balance": allowPositiveBalance,
		},
		callerID); err != nil {
		return fmt.Errorf("insert pago_cc_cruzado audit: %w", err)
	}

	if err := confirmMovementDraftTx(ctx, tx, s.pool, s.operationRepo, s.auditRepo, movementID, callerID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func normalizePagoCCMode(mode string) string {
	switch strings.ToUpper(strings.TrimSpace(mode)) {
	case "", "ENTRA":
		return "ENTRA"
	case "SALE":
		return "SALE"
	default:
		return ""
	}
}

func (s *PagoCCCruzadoService) getCCBalanceForUpdate(ctx context.Context, tx pgx.Tx, clientID, currencyID string) (*big.Rat, error) {
	var balanceStr string
	err := tx.QueryRow(ctx,
		`SELECT balance::text
		 FROM cc_balances
		 WHERE client_id = $1 AND currency_id = $2
		 FOR UPDATE`,
		clientID, currencyID).Scan(&balanceStr)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return new(big.Rat), nil
		}
		return nil, err
	}
	balance, ok := new(big.Rat).SetString(balanceStr)
	if !ok {
		return nil, ErrInvalidAmount
	}
	return balance, nil
}

func (s *PagoCCCruzadoService) getSettingBoolTx(ctx context.Context, tx pgx.Tx, key string, fallback bool) (bool, error) {
	var raw string
	err := tx.QueryRow(ctx, `SELECT value_json::text FROM system_settings WHERE key = $1`, key).Scan(&raw)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fallback, nil
		}
		return false, err
	}
	var v bool
	if err := json.Unmarshal([]byte(raw), &v); err != nil {
		return fallback, nil
	}
	return v, nil
}
