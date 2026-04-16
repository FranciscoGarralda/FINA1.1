package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strings"

	"fina/internal/repositories"

	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrDeliveryAmountInvalid        = errors.New("DELIVERY_AMOUNT_INVALID")
	ErrDeliveryNetInvalid           = errors.New("DELIVERY_NET_INVALID")
	ErrCollectionsRequired          = errors.New("COLLECTIONS_REQUIRED")
	ErrCollectionAmtInvalid         = errors.New("COLLECTION_AMOUNT_INVALID")
	ErrFeeValueInvalid              = errors.New("FEE_VALUE_INVALID")
	ErrTotalDueMismatch             = errors.New("TOTAL_DUE_MISMATCH")
	ErrMixedCurrencyNotSupp         = errors.New("MIXED_CURRENCY_NOT_SUPPORTED")
	ErrTransfClientRequired         = errors.New("TRANSF_CLIENT_REQUIRED")
	ErrInvalidSettlement            = errors.New("INVALID_SETTLEMENT")
	ErrCCSettlementNotAllowed       = errors.New("CC_SETTLEMENT_NOT_ALLOWED")
	ErrInvalidFeePayer              = errors.New("INVALID_FEE_PAYER")
	ErrInvalidFeeTreatment          = errors.New("INVALID_FEE_TREATMENT")
	ErrInvalidFeeSettlement         = errors.New("INVALID_FEE_SETTLEMENT")
	ErrFeeIncludedPendingNotAllowed = errors.New("FEE_INCLUDED_PENDING_NOT_ALLOWED")
	ErrFeeCurrencyRequired          = errors.New("FEE_CURRENCY_REQUIRED")
	ErrFeeAccountRequired           = errors.New("FEE_ACCOUNT_REQUIRED")
	ErrFeeFormatRequired            = errors.New("FEE_FORMAT_REQUIRED")
	ErrInvalidLegSettlement         = errors.New("INVALID_LEG_SETTLEMENT")
	ErrLegAmountInvalid             = errors.New("LEG_AMOUNT_INVALID")
	ErrLegsCannotBeEqual            = errors.New("LEGS_CANNOT_BE_EQUAL")
	ErrFeePercentBaseInvalid        = errors.New("FEE_PERCENT_BASE_INVALID")
	// keep old names referenced by handler for backward compat
	ErrConfirmNoFXRequired  = errors.New("CONFIRM_NO_FX_REQUIRED")
	ErrFeeSumMismatch       = errors.New("FEE_SUM_MISMATCH")
	ErrAntiFloatingMismatch = errors.New("ANTI_FLOATING_MISMATCH")
	ErrNoFXFeeRequired      = errors.New("NO_FX_FEE_REQUIRED")
	ErrTransferQuoteRequired = errors.New("TRANSFER_QUOTE_REQUIRED")
	ErrTransferQuoteMismatch = errors.New("TRANSFER_QUOTE_MISMATCH")
	ErrTransferCrossFunctional = errors.New("TRANSFER_CROSS_FUNCTIONAL_REQUIRED")
)

type TransfDelivery struct {
	AccountID  string  `json:"account_id"`
	CurrencyID string  `json:"currency_id"`
	Format     string  `json:"format"`
	Amount     string  `json:"amount"`
	Settlement string  `json:"settlement"`
	Note       *string `json:"note,omitempty"`
}

type TransfCollection struct {
	Settlement string  `json:"settlement"`
	AccountID  string  `json:"account_id"`
	CurrencyID string  `json:"currency_id"`
	Format     string  `json:"format"`
	Amount     string  `json:"amount"`
	Note       *string `json:"note,omitempty"`
}

type TransfFeeConfig struct {
	Enabled    bool   `json:"enabled"`
	Mode       string `json:"mode"` // PERCENT | FIXED
	Value      string `json:"value"`
	Treatment  string `json:"treatment"`  // APARTE | INCLUIDA
	Payer      string `json:"payer"`      // CLIENTE_PAGA | NOSOTROS_PAGAMOS
	Settlement string `json:"settlement"` // REAL | PENDIENTE
	CurrencyID string `json:"currency_id"`
	AccountID  string `json:"account_id"`
	Format     string `json:"format"`
	// Sign: compatibilidad lectura drafts/API antiguos (TRANSFERENCIA); PLUS|MINUS mapea a feeTreatment en mapDraft.
	Sign string `json:"sign"` // legacy: PLUS | MINUS
}

type TransfLeg struct {
	AccountID  string `json:"account_id"`
	CurrencyID string `json:"currency_id"`
	Format     string `json:"format"`
	Amount     string `json:"amount"`     // positive amount
	Settlement string `json:"settlement"` // REAL | PENDIENTE
}

// TransfQuote cotización del cruce mesa (misma forma que CompraQuote / VentaQuote).
// Opcional en JSON: obligatoria cuando out_leg e in_leg tienen divisas distintas y una es la moneda funcional FX.
type TransfQuote struct {
	Rate       string `json:"rate"`
	CurrencyID string `json:"currency_id"`
	Mode       string `json:"mode"`
}

type TransfTransfer struct {
	AccountID  string  `json:"account_id"`
	CurrencyID string  `json:"currency_id"`
	Format     string  `json:"format"`
	Amount     string  `json:"amount"` // signed: >0 ENTRA, <0 SALE
	Pending    bool    `json:"pending"`
	Note       *string `json:"note,omitempty"`
}

type TransferenciaInput struct {
	OutLeg      TransfLeg          `json:"out_leg"`
	InLeg       TransfLeg          `json:"in_leg"`
	Quote       *TransfQuote       `json:"quote,omitempty"`
	Transfer    TransfTransfer     `json:"transfer"`
	Delivery    TransfDelivery     `json:"delivery"`
	Collections []TransfCollection `json:"collections"`
	Fee         TransfFeeConfig    `json:"fee"`
}

type TransferenciaService struct {
	pool          *pgxpool.Pool
	operationRepo *repositories.OperationRepo
	ccSvc         *CCService
	auditRepo     *repositories.AuditRepo
}

func NewTransferenciaService(pool *pgxpool.Pool, opRepo *repositories.OperationRepo, ccSvc *CCService, auditRepo *repositories.AuditRepo) *TransferenciaService {
	return &TransferenciaService{pool: pool, operationRepo: opRepo, ccSvc: ccSvc, auditRepo: auditRepo}
}

func ratTrim(r *big.Rat) string {
	return strings.TrimRight(strings.TrimRight(r.FloatString(8), "0"), ".")
}

func validSettlement(s string) bool {
	return s == "REAL" || s == "OWED_PENDING"
}

func validLegSettlement(s string) bool {
	return s == "REAL" || s == "PENDIENTE"
}

func validateFmt(f string) error {
	if f != "CASH" && f != "DIGITAL" {
		return fmt.Errorf("invalid format: %s", f)
	}
	return nil
}

func loadFunctionalCurrencyIDFromPool(ctx context.Context, pool *pgxpool.Pool) (string, error) {
	var raw string
	err := pool.QueryRow(ctx,
		`SELECT value_json::text FROM system_settings WHERE key = 'fx_functional_currency_code'`).Scan(&raw)
	if err != nil {
		return "", ErrFXFunctionalCurrencyUnset
	}
	var code string
	if err := json.Unmarshal([]byte(raw), &code); err != nil || code == "" {
		return "", ErrFXFunctionalCurrencyUnset
	}
	var id string
	err = pool.QueryRow(ctx,
		`SELECT id::text FROM currencies WHERE UPPER(code) = UPPER($1) AND active = true`, code).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("%w: código %q", ErrFXFunctionalCurrencyUnset, code)
	}
	return id, nil
}

// deriveFeeAccountAndFormat asigna cuenta y formato de comisión a la pata cuya divisa coincide (D4).
func deriveFeeAccountAndFormat(feeCurrencyID string, outL, inL TransfLeg) (accountID, format string, ok bool) {
	fc := strings.TrimSpace(feeCurrencyID)
	if fc == "" {
		return "", "", false
	}
	if fc == strings.TrimSpace(outL.CurrencyID) {
		ac := strings.TrimSpace(outL.AccountID)
		f := strings.ToUpper(strings.TrimSpace(outL.Format))
		if ac != "" && (f == "CASH" || f == "DIGITAL") {
			return ac, f, true
		}
	}
	if fc == strings.TrimSpace(inL.CurrencyID) {
		ac := strings.TrimSpace(inL.AccountID)
		f := strings.ToUpper(strings.TrimSpace(inL.Format))
		if ac != "" && (f == "CASH" || f == "DIGITAL") {
			return ac, f, true
		}
	}
	return "", "", false
}

// validateDualLegCrossCurrencyAndQuote valida cotización y cuadre mesa cuando hay dos divisas (una = moneda funcional).
func validateDualLegCrossCurrencyAndQuote(ctx context.Context, pool *pgxpool.Pool, input TransferenciaInput, outAmt, inAmt *big.Rat) (*TransfQuote, error) {
	outCID := strings.TrimSpace(input.OutLeg.CurrencyID)
	inCID := strings.TrimSpace(input.InLeg.CurrencyID)
	if outCID == inCID {
		return nil, nil
	}
	functionalID, err := loadFunctionalCurrencyIDFromPool(ctx, pool)
	if err != nil {
		return nil, err
	}
	var q TransfQuote
	if input.Quote != nil {
		q = *input.Quote
	}
	if strings.TrimSpace(q.Rate) == "" {
		return nil, ErrTransferQuoteRequired
	}
	quoteRate, ok := new(big.Rat).SetString(strings.TrimSpace(q.Rate))
	if !ok || quoteRate.Sign() <= 0 {
		return nil, ErrTransferQuoteMismatch
	}
	modeNorm := normalizeQuoteMode(q.Mode)
	if modeNorm == "" {
		return nil, ErrInvalidQuoteMode
	}
	qcid := strings.TrimSpace(q.CurrencyID)
	if qcid == "" {
		qcid = functionalID
	} else if qcid != functionalID {
		return nil, ErrFXQuoteNotFunctional
	}

	if outCID != functionalID && inCID == functionalID {
		if !cuadreTransfOK(outAmt, inAmt, quoteRate, modeNorm) {
			return nil, ErrTransferQuoteMismatch
		}
		return &TransfQuote{Rate: strings.TrimSpace(q.Rate), CurrencyID: qcid, Mode: modeNorm}, nil
	}
	if outCID == functionalID && inCID != functionalID {
		if !cuadreTransfOK(inAmt, outAmt, quoteRate, modeNorm) {
			return nil, ErrTransferQuoteMismatch
		}
		return &TransfQuote{Rate: strings.TrimSpace(q.Rate), CurrencyID: qcid, Mode: modeNorm}, nil
	}
	return nil, ErrTransferCrossFunctional
}

func (s *TransferenciaService) Execute(ctx context.Context, movementID string, input TransferenciaInput, callerID string) error {
	var movType, movStatus string
	var clientID *string
	var ccEnabled bool
	err := s.pool.QueryRow(ctx,
		`SELECT m.type, m.status, m.client_id::text, COALESCE(c.cc_enabled, false)
		 FROM movements m
		 LEFT JOIN clients c ON c.id = m.client_id
		 WHERE m.id = $1`, movementID).
		Scan(&movType, &movStatus, &clientID, &ccEnabled)
	if err != nil {
		return ErrMovementNotFound
	}
	if movType != "TRANSFERENCIA" {
		return ErrMovementTypeMismatch
	}
	if movStatus != MovementStatusDraft {
		return ErrMovementNotDraft
	}
	if clientID == nil || *clientID == "" {
		return ErrTransfClientRequired
	}

	// New model (priority): explicit dual-leg transfer.
	if strings.TrimSpace(input.OutLeg.Amount) != "" || strings.TrimSpace(input.InLeg.Amount) != "" {
		return s.executeDualLegTransfer(ctx, movementID, *clientID, ccEnabled, input, callerID)
	}

	// New explicit model: one signed transfer line (+ ENTRA / - SALE).
	if strings.TrimSpace(input.Transfer.Amount) != "" || input.Transfer.AccountID != "" || input.Transfer.CurrencyID != "" {
		return s.executeSignedTransfer(ctx, movementID, *clientID, ccEnabled, input, callerID)
	}

	// --- Parse & validate delivery ---
	deliveryInputAmt, ok := new(big.Rat).SetString(input.Delivery.Amount)
	if !ok || deliveryInputAmt.Sign() <= 0 {
		return ErrDeliveryAmountInvalid
	}
	if err := validateFmt(input.Delivery.Format); err != nil {
		return ErrDeliveryAmountInvalid
	}
	if input.Delivery.Settlement == "OWED_CC" {
		return ErrCCSettlementNotAllowed
	}
	if !validSettlement(input.Delivery.Settlement) {
		return ErrInvalidSettlement
	}
	if input.Delivery.Settlement == "REAL" || input.Delivery.Settlement == "OWED_PENDING" {
		if err := s.operationRepo.ValidateAccountCurrencyFormat(ctx,
			input.Delivery.AccountID, input.Delivery.CurrencyID, input.Delivery.Format); err != nil {
			return err
		}
	}

	// --- Fee computation ---
	var expectedFee *big.Rat
	var deliveryOutAmt *big.Rat
	hasFee := input.Fee.Enabled

	if hasFee {
		feeVal, ok := new(big.Rat).SetString(input.Fee.Value)
		if !ok || feeVal.Sign() < 0 {
			return ErrFeeValueInvalid
		}
		if feeVal.Sign() > 0 {
			switch input.Fee.Mode {
			case "PERCENT":
				hundred := new(big.Rat).SetInt64(100)
				expectedFee = new(big.Rat).Mul(deliveryInputAmt, feeVal)
				expectedFee.Quo(expectedFee, hundred)
			case "FIXED":
				expectedFee = new(big.Rat).Set(feeVal)
			default:
				return ErrFeeValueInvalid
			}
		} else {
			expectedFee = new(big.Rat)
		}

		if input.Fee.Sign == "MINUS" {
			deliveryOutAmt = new(big.Rat).Sub(deliveryInputAmt, expectedFee)
			if deliveryOutAmt.Sign() <= 0 {
				return ErrDeliveryNetInvalid
			}
		} else {
			deliveryOutAmt = new(big.Rat).Set(deliveryInputAmt)
		}
	} else {
		expectedFee = new(big.Rat)
		deliveryOutAmt = new(big.Rat).Set(deliveryInputAmt)
	}

	// --- Validate collections ---
	if len(input.Collections) == 0 {
		return ErrCollectionsRequired
	}

	totalCollected := new(big.Rat)
	collAmts := make([]*big.Rat, len(input.Collections))

	for i, c := range input.Collections {
		amt, ok := new(big.Rat).SetString(c.Amount)
		if !ok || amt.Sign() <= 0 {
			return ErrCollectionAmtInvalid
		}
		if err := validateFmt(c.Format); err != nil {
			return ErrCollectionAmtInvalid
		}
		if c.Settlement == "OWED_CC" {
			return ErrCCSettlementNotAllowed
		}
		if !validSettlement(c.Settlement) {
			return ErrInvalidSettlement
		}
		// Strict: all collections must be same currency as delivery
		if c.CurrencyID != input.Delivery.CurrencyID {
			return ErrMixedCurrencyNotSupp
		}
		if c.Settlement == "REAL" || c.Settlement == "OWED_PENDING" {
			if err := s.operationRepo.ValidateAccountCurrencyFormat(ctx, c.AccountID, c.CurrencyID, c.Format); err != nil {
				return err
			}
		}
		collAmts[i] = amt
		totalCollected.Add(totalCollected, amt)
	}

	// --- Anti-floating: total_collected == total_due ---
	// total_due = deliveryOutAmt (principal) + expectedFee (for PLUS)
	// For MINUS: total_due = deliveryInputAmt (because fee is inside)
	var totalDue *big.Rat
	if hasFee && input.Fee.Sign == "MINUS" {
		totalDue = new(big.Rat).Set(deliveryInputAmt)
	} else {
		totalDue = new(big.Rat).Add(new(big.Rat).Set(deliveryOutAmt), expectedFee)
	}
	if totalCollected.Cmp(totalDue) != 0 {
		return ErrTotalDueMismatch
	}

	// --- Begin transaction ---
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	deliveryOutStr := ratTrim(deliveryOutAmt)

	// 1) Delivery
	switch input.Delivery.Settlement {
	case "REAL":
		_, err = s.operationRepo.InsertMovementLine(ctx, tx, movementID, "OUT",
			input.Delivery.AccountID, input.Delivery.CurrencyID, input.Delivery.Format,
			deliveryOutStr, false)
		if err != nil {
			return fmt.Errorf("insert delivery OUT: %w", err)
		}
		if ccEnabled {
			ccNote := "Transferencia — entrega real"
			if input.Delivery.Note != nil && *input.Delivery.Note != "" {
				ccNote = *input.Delivery.Note
			}
			err = applyCCImpactTx(ctx, s.ccSvc, tx, *clientID, input.Delivery.CurrencyID, deliveryOutStr, movementID, ccSideOut, ccNote, callerID)
			if err != nil {
				return fmt.Errorf("insert delivery cc_entry real: %w", err)
			}
		}

	case "OWED_PENDING":
		lineID, err := s.operationRepo.InsertMovementLine(ctx, tx, movementID, "OUT",
			input.Delivery.AccountID, input.Delivery.CurrencyID, input.Delivery.Format,
			deliveryOutStr, true)
		if err != nil {
			return fmt.Errorf("insert delivery OUT pending: %w", err)
		}
		_, err = s.operationRepo.InsertPendingItem(ctx, tx, lineID, "PENDIENTE_DE_RETIRO",
			*clientID, input.Delivery.CurrencyID, deliveryOutStr, true)
		if err != nil {
			return fmt.Errorf("insert delivery pending item: %w", err)
		}

	}

	// 2) Collections + automatic allocation (principal first, then fee)
	principalRemaining := new(big.Rat).Set(deliveryOutAmt)
	feeRemaining := new(big.Rat).Set(expectedFee)

	for i, c := range input.Collections {
		cAmtStr := ratTrim(collAmts[i])

		switch c.Settlement {
		case "REAL":
			_, err = s.operationRepo.InsertMovementLine(ctx, tx, movementID, "IN",
				c.AccountID, c.CurrencyID, c.Format, cAmtStr, false)
			if err != nil {
				return fmt.Errorf("insert collection IN %d: %w", i, err)
			}
			if ccEnabled {
				ccNote := "Transferencia — cobro real"
				if c.Note != nil && *c.Note != "" {
					ccNote = *c.Note
				}
				err = applyCCImpactTx(ctx, s.ccSvc, tx, *clientID, c.CurrencyID, cAmtStr, movementID, ccSideIn, ccNote, callerID)
				if err != nil {
					return fmt.Errorf("insert collection cc_entry real %d: %w", i, err)
				}
			}

		case "OWED_PENDING":
			lineID, err := s.operationRepo.InsertMovementLine(ctx, tx, movementID, "IN",
				c.AccountID, c.CurrencyID, c.Format, cAmtStr, true)
			if err != nil {
				return fmt.Errorf("insert collection IN pending %d: %w", i, err)
			}
			_, err = s.operationRepo.InsertPendingItem(ctx, tx, lineID, "PENDIENTE_DE_PAGO",
				*clientID, c.CurrencyID, cAmtStr, true)
			if err != nil {
				return fmt.Errorf("insert collection pending item %d: %w", i, err)
			}

		}

		// Allocate: principal first, then fee
		applyPrincipal := minRat(collAmts[i], principalRemaining)
		principalRemaining.Sub(principalRemaining, applyPrincipal)
		remainder := new(big.Rat).Sub(collAmts[i], applyPrincipal)
		applyFee := minRat(remainder, feeRemaining)
		feeRemaining.Sub(feeRemaining, applyFee)

		if applyFee.Sign() > 0 {
			feeStr := ratTrim(applyFee)
			_, err = s.operationRepo.InsertProfitEntry(ctx, tx, movementID,
				c.CurrencyID, feeStr, c.AccountID, c.Format)
			if err != nil {
				return fmt.Errorf("insert profit entry %d: %w", i, err)
			}
			// Solo CC de fee atribuido a cobro REAL; si el cobro es OWED_PENDING el CC del fee se difiere vía pendiente de cobro (riesgo residual si fee queda solo en flujos pending-only).
			if ccEnabled && c.Settlement == "REAL" {
				if err := applyCCImpactTx(ctx, s.ccSvc, tx, *clientID, c.CurrencyID, feeStr, movementID, ccSideIn, "Transferencia — comisión", callerID); err != nil {
					return fmt.Errorf("insert fee cc_entry %d: %w", i, err)
				}
			}
		}
	}

	// 3) Audit
	if err := s.auditRepo.InsertTx(ctx, tx, "movement", &movementID, "transferencia",
		nil,
		map[string]interface{}{
			"delivery_currency":   input.Delivery.CurrencyID,
			"delivery_amount_in":  input.Delivery.Amount,
			"delivery_out":        deliveryOutStr,
			"delivery_settlement": input.Delivery.Settlement,
			"collections_count":   len(input.Collections),
			"fee_enabled":         hasFee,
			"fee_expected":        ratTrim(expectedFee),
		},
		callerID); err != nil {
		return fmt.Errorf("insert transferencia audit: %w", err)
	}

	if err := confirmMovementDraftTx(ctx, tx, s.pool, s.operationRepo, s.auditRepo, movementID, callerID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (s *TransferenciaService) executeDualLegTransfer(ctx context.Context, movementID, clientID string, ccEnabled bool, input TransferenciaInput, callerID string) error {
	outSettle := strings.ToUpper(strings.TrimSpace(input.OutLeg.Settlement))
	inSettle := strings.ToUpper(strings.TrimSpace(input.InLeg.Settlement))
	if !validLegSettlement(outSettle) || !validLegSettlement(inSettle) {
		return ErrInvalidLegSettlement
	}
	if strings.TrimSpace(input.OutLeg.AccountID) == "" || strings.TrimSpace(input.OutLeg.CurrencyID) == "" {
		return ErrLegAmountInvalid
	}
	if strings.TrimSpace(input.InLeg.AccountID) == "" || strings.TrimSpace(input.InLeg.CurrencyID) == "" {
		return ErrLegAmountInvalid
	}
	if err := validateFmt(input.OutLeg.Format); err != nil {
		return ErrLegAmountInvalid
	}
	if err := validateFmt(input.InLeg.Format); err != nil {
		return ErrLegAmountInvalid
	}
	outAmt, ok := new(big.Rat).SetString(strings.TrimSpace(input.OutLeg.Amount))
	if !ok || outAmt.Sign() <= 0 {
		return ErrLegAmountInvalid
	}
	inAmt, ok := new(big.Rat).SetString(strings.TrimSpace(input.InLeg.Amount))
	if !ok || inAmt.Sign() <= 0 {
		return ErrLegAmountInvalid
	}
	if input.OutLeg.AccountID == input.InLeg.AccountID &&
		input.OutLeg.CurrencyID == input.InLeg.CurrencyID &&
		input.OutLeg.Format == input.InLeg.Format {
		return ErrLegsCannotBeEqual
	}
	if err := s.operationRepo.ValidateAccountCurrencyFormat(ctx, input.OutLeg.AccountID, input.OutLeg.CurrencyID, input.OutLeg.Format); err != nil {
		return err
	}
	if err := s.operationRepo.ValidateAccountCurrencyFormat(ctx, input.InLeg.AccountID, input.InLeg.CurrencyID, input.InLeg.Format); err != nil {
		return err
	}

	feeMode := strings.ToUpper(strings.TrimSpace(input.Fee.Mode))
	feeTreatment := strings.ToUpper(strings.TrimSpace(input.Fee.Treatment))
	feePayer := strings.ToUpper(strings.TrimSpace(input.Fee.Payer))
	feeSettlement := strings.ToUpper(strings.TrimSpace(input.Fee.Settlement))
	if feeMode == "" {
		feeMode = "PERCENT"
	}
	if feeTreatment == "" {
		feeTreatment = "APARTE"
	}
	if feePayer == "" {
		feePayer = "CLIENTE_PAGA"
	}
	if feeSettlement == "" {
		feeSettlement = "REAL"
	}
	if !validFeeMode(feeMode) {
		return ErrFeeValueInvalid
	}
	if !validFeeTreatment(feeTreatment) {
		return ErrInvalidFeeTreatment
	}
	if !validFeePayer(feePayer) {
		return ErrInvalidFeePayer
	}
	if !validFeeSettlement(feeSettlement) {
		return ErrInvalidFeeSettlement
	}
	if feeTreatment == "INCLUIDA" && feeSettlement == "PENDIENTE" {
		return ErrFeeIncludedPendingNotAllowed
	}

	resolvedQuote, err := validateDualLegCrossCurrencyAndQuote(ctx, s.pool, input, outAmt, inAmt)
	if err != nil {
		return err
	}

	feeAmt := new(big.Rat)
	feeCurrencyID := strings.TrimSpace(input.Fee.CurrencyID)
	feeAccountID := strings.TrimSpace(input.Fee.AccountID)
	feeFormat := strings.ToUpper(strings.TrimSpace(input.Fee.Format))
	if input.Fee.Enabled {
		if feeCurrencyID == "" {
			return ErrFeeCurrencyRequired
		}
		if feeAccountID == "" {
			if a, f, ok := deriveFeeAccountAndFormat(feeCurrencyID, input.OutLeg, input.InLeg); ok {
				feeAccountID = a
				if feeFormat == "" {
					feeFormat = f
				}
			}
		}
		if feeAccountID == "" {
			return ErrFeeAccountRequired
		}
		if feeFormat == "" {
			return ErrFeeFormatRequired
		}
		if err := validateFmt(feeFormat); err != nil {
			return ErrFeeFormatRequired
		}
		if err := s.operationRepo.ValidateAccountCurrencyFormat(ctx, feeAccountID, feeCurrencyID, feeFormat); err != nil {
			return err
		}
		rawFee, ok := new(big.Rat).SetString(strings.TrimSpace(input.Fee.Value))
		if !ok || rawFee.Sign() < 0 {
			return ErrFeeValueInvalid
		}
		if rawFee.Sign() > 0 {
			switch feeMode {
			case "PERCENT":
				var base *big.Rat
				switch feeCurrencyID {
				case input.InLeg.CurrencyID:
					base = new(big.Rat).Set(inAmt)
				case input.OutLeg.CurrencyID:
					base = new(big.Rat).Set(outAmt)
				default:
					return ErrFeePercentBaseInvalid
				}
				feeAmt = new(big.Rat).Mul(base, rawFee)
				feeAmt.Quo(feeAmt, new(big.Rat).SetInt64(100))
			case "FIXED":
				feeAmt = new(big.Rat).Set(rawFee)
			default:
				return ErrFeeValueInvalid
			}
		}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	outAmtStr := ratTrim(outAmt)
	inAmtStr := ratTrim(inAmt)

	outPending := outSettle == "PENDIENTE"
	outLineID, err := s.operationRepo.InsertMovementLine(ctx, tx, movementID, "OUT",
		input.OutLeg.AccountID, input.OutLeg.CurrencyID, input.OutLeg.Format, outAmtStr, outPending)
	if err != nil {
		return fmt.Errorf("insert out leg line: %w", err)
	}
	if outPending {
		if _, err := s.operationRepo.InsertPendingItem(ctx, tx, outLineID, "PENDIENTE_DE_PAGO", clientID, input.OutLeg.CurrencyID, outAmtStr, true); err != nil {
			return fmt.Errorf("insert out leg pending: %w", err)
		}
	}
	inPending := inSettle == "PENDIENTE"
	inLineID, err := s.operationRepo.InsertMovementLine(ctx, tx, movementID, "IN",
		input.InLeg.AccountID, input.InLeg.CurrencyID, input.InLeg.Format, inAmtStr, inPending)
	if err != nil {
		return fmt.Errorf("insert in leg line: %w", err)
	}
	if inPending {
		if _, err := s.operationRepo.InsertPendingItem(ctx, tx, inLineID, "PENDIENTE_DE_RETIRO", clientID, input.InLeg.CurrencyID, inAmtStr, true); err != nil {
			return fmt.Errorf("insert in leg pending: %w", err)
		}
	}

	if ccEnabled {
		if !outPending {
			if err := applyCCImpactTx(ctx, s.ccSvc, tx, clientID, input.OutLeg.CurrencyID, outAmtStr, movementID, ccSideOut, "Transferencia — salida", callerID); err != nil {
				return fmt.Errorf("apply cc out leg: %w", err)
			}
		}
		if !inPending {
			if err := applyCCImpactTx(ctx, s.ccSvc, tx, clientID, input.InLeg.CurrencyID, inAmtStr, movementID, ccSideIn, "Transferencia — entrada", callerID); err != nil {
				return fmt.Errorf("apply cc in leg: %w", err)
			}
		}
	}

	if input.Fee.Enabled && feeAmt.Sign() > 0 {
		feeStr := ratTrim(feeAmt)
		feeLineSide := "IN"
		feeCCSide := ccSideOut
		feePendingType := "PENDIENTE_DE_RETIRO"
		feeProfitAmount := feeStr
		if feePayer == "NOSOTROS_PAGAMOS" {
			feeLineSide = "OUT"
			feeCCSide = ccSideIn
			feePendingType = "PENDIENTE_DE_PAGO"
			feeProfitAmount = "-" + feeStr
		}

		if feeTreatment == "APARTE" {
			if feeSettlement == "REAL" {
				if _, err := s.operationRepo.InsertMovementLine(ctx, tx, movementID, feeLineSide, feeAccountID, feeCurrencyID, feeFormat, feeStr, false); err != nil {
					return fmt.Errorf("insert fee real line: %w", err)
				}
			} else {
				feeLineID, err := s.operationRepo.InsertMovementLine(ctx, tx, movementID, feeLineSide, feeAccountID, feeCurrencyID, feeFormat, feeStr, true)
				if err != nil {
					return fmt.Errorf("insert fee pending line: %w", err)
				}
				if _, err := s.operationRepo.InsertPendingItem(ctx, tx, feeLineID, feePendingType, clientID, feeCurrencyID, feeStr, true); err != nil {
					return fmt.Errorf("insert fee pending item: %w", err)
				}
			}
		}

		// INCLUIDA: la comisión va dentro del monto de pata(s); no duplicar impacto CC sobre el mismo fee (regla no doble impacto).
		if ccEnabled && feeTreatment == "APARTE" && feeSettlement == "REAL" {
			if err := applyCCImpactTx(ctx, s.ccSvc, tx, clientID, feeCurrencyID, feeStr, movementID, feeCCSide, "Transferencia — comisión", callerID); err != nil {
				return fmt.Errorf("apply cc fee: %w", err)
			}
		}

		if _, err := s.operationRepo.InsertProfitEntry(ctx, tx, movementID, feeCurrencyID, feeProfitAmount, feeAccountID, feeFormat); err != nil {
			return fmt.Errorf("insert fee profit entry: %w", err)
		}
	}

	auditAfter := map[string]interface{}{
		"model":           "DUAL_LEG_TRANSFER",
		"out_leg":         input.OutLeg,
		"in_leg":          input.InLeg,
		"fee_enabled":     input.Fee.Enabled,
		"fee_mode":        feeMode,
		"fee_treatment":   feeTreatment,
		"fee_payer":       feePayer,
		"fee_settlement":  feeSettlement,
		"fee_currency_id": feeCurrencyID,
		"fee_account_id":  feeAccountID,
		// payload_priority: trazabilidad auditoría — payload dual-leg vs. borradores antiguos.
		"payload_priority": "out_leg_in_leg_over_legacy",
	}
	if resolvedQuote != nil {
		auditAfter["quote"] = resolvedQuote
	}
	if err := s.auditRepo.InsertTx(ctx, tx, "movement", &movementID, "transferencia",
		nil,
		auditAfter,
		callerID); err != nil {
		return fmt.Errorf("insert dual leg transferencia audit: %w", err)
	}

	if err := confirmMovementDraftTx(ctx, tx, s.pool, s.operationRepo, s.auditRepo, movementID, callerID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *TransferenciaService) executeSignedTransfer(ctx context.Context, movementID, clientID string, ccEnabled bool, input TransferenciaInput, callerID string) error {
	if strings.TrimSpace(input.Transfer.AccountID) == "" || strings.TrimSpace(input.Transfer.CurrencyID) == "" {
		return ErrDeliveryAmountInvalid
	}
	if err := validateFmt(input.Transfer.Format); err != nil {
		return ErrDeliveryAmountInvalid
	}
	transferAmt, ok := new(big.Rat).SetString(strings.TrimSpace(input.Transfer.Amount))
	if !ok || transferAmt.Sign() == 0 {
		return ErrDeliveryAmountInvalid
	}

	side := "IN"
	if transferAmt.Sign() < 0 {
		side = "OUT"
	}
	absTransfer := new(big.Rat).Abs(transferAmt)
	if err := s.operationRepo.ValidateAccountCurrencyFormat(ctx, input.Transfer.AccountID, input.Transfer.CurrencyID, input.Transfer.Format); err != nil {
		return err
	}

	feeMode := strings.ToUpper(strings.TrimSpace(input.Fee.Mode))
	feeTreatment := strings.ToUpper(strings.TrimSpace(input.Fee.Treatment))
	feePayer := strings.ToUpper(strings.TrimSpace(input.Fee.Payer))
	feeSettlement := strings.ToUpper(strings.TrimSpace(input.Fee.Settlement))
	legacyFeeSign := strings.ToUpper(strings.TrimSpace(input.Fee.Sign))

	// Backward compatibility defaults and legacy mapping.
	if feeMode == "" {
		feeMode = "PERCENT"
	}
	if feeTreatment == "" {
		feeTreatment = "APARTE"
		if legacyFeeSign == "MINUS" {
			feeTreatment = "INCLUIDA"
		}
	}
	if feePayer == "" {
		feePayer = "CLIENTE_PAGA"
	}
	if feeSettlement == "" {
		feeSettlement = "REAL"
	}
	if !validFeeMode(feeMode) {
		return ErrFeeValueInvalid
	}
	if !validFeeTreatment(feeTreatment) {
		return ErrInvalidFeeTreatment
	}
	if !validFeePayer(feePayer) {
		return ErrInvalidFeePayer
	}
	if !validFeeSettlement(feeSettlement) {
		return ErrInvalidFeeSettlement
	}
	if feeTreatment == "INCLUIDA" && feeSettlement == "PENDIENTE" {
		return ErrFeeIncludedPendingNotAllowed
	}

	feeAmt := new(big.Rat)
	if input.Fee.Enabled {
		rawFee, ok := new(big.Rat).SetString(strings.TrimSpace(input.Fee.Value))
		if !ok || rawFee.Sign() < 0 {
			return ErrFeeValueInvalid
		}
		if rawFee.Sign() > 0 {
			switch feeMode {
			case "PERCENT":
				feeAmt = new(big.Rat).Mul(absTransfer, rawFee)
				feeAmt = feeAmt.Quo(feeAmt, new(big.Rat).SetInt64(100))
			case "FIXED":
				feeAmt = new(big.Rat).Set(rawFee)
			default:
				return ErrFeeValueInvalid
			}
		}
	}

	if input.Fee.Enabled && feeAmt.Sign() > 0 && feeTreatment == "INCLUIDA" {
		netCheck := new(big.Rat).Sub(absTransfer, feeAmt)
		if netCheck.Sign() <= 0 {
			return ErrDeliveryNetInvalid
		}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	absTransferStr := ratTrim(absTransfer)
	isPending := input.Transfer.Pending
	lineID, err := s.operationRepo.InsertMovementLine(ctx, tx, movementID, side,
		input.Transfer.AccountID, input.Transfer.CurrencyID, input.Transfer.Format, absTransferStr, isPending)
	if err != nil {
		return fmt.Errorf("insert signed transfer line: %w", err)
	}
	if isPending {
		pType := "PENDIENTE_DE_RETIRO"
		if side == "OUT" {
			pType = "PENDIENTE_DE_PAGO"
		}
		if _, err := s.operationRepo.InsertPendingItem(ctx, tx, lineID, pType, clientID, input.Transfer.CurrencyID, absTransferStr, true); err != nil {
			return fmt.Errorf("insert signed transfer pending: %w", err)
		}
	}

	if ccEnabled && !isPending {
		ccSide := ccSideIn
		if side == "OUT" {
			ccSide = ccSideOut
		}
		ccNote := "Transferencia"
		if input.Transfer.Note != nil && *input.Transfer.Note != "" {
			ccNote = *input.Transfer.Note
		}
		if err := applyCCImpactTx(ctx, s.ccSvc, tx, clientID, input.Transfer.CurrencyID, absTransferStr, movementID, ccSide, ccNote, callerID); err != nil {
			return fmt.Errorf("apply signed transfer cc principal impact: %w", err)
		}
	}

	if input.Fee.Enabled && feeAmt.Sign() > 0 {
		feeStr := ratTrim(feeAmt)

		feeLineSide := "IN"
		feeCCSide := ccSideOut
		feePendingType := "PENDIENTE_DE_COBRO_COMISION"
		feeProfitAmount := feeStr
		if feePayer == "NOSOTROS_PAGAMOS" {
			feeLineSide = "OUT"
			feeCCSide = ccSideIn
			feePendingType = "PENDIENTE_DE_PAGO_COMISION"
			feeProfitAmount = "-" + feeStr
		}

		if feeTreatment == "APARTE" {
			if feeSettlement == "REAL" {
				_, err = s.operationRepo.InsertMovementLine(ctx, tx, movementID, feeLineSide,
					input.Transfer.AccountID, input.Transfer.CurrencyID, input.Transfer.Format, feeStr, false)
				if err != nil {
					return fmt.Errorf("insert signed transfer fee real line: %w", err)
				}
			} else {
				feeLineID, err := s.operationRepo.InsertMovementLine(ctx, tx, movementID, feeLineSide,
					input.Transfer.AccountID, input.Transfer.CurrencyID, input.Transfer.Format, feeStr, true)
				if err != nil {
					return fmt.Errorf("insert signed transfer fee pending line: %w", err)
				}
				if _, err := s.operationRepo.InsertPendingItem(ctx, tx, feeLineID, feePendingType, clientID, input.Transfer.CurrencyID, feeStr, true); err != nil {
					return fmt.Errorf("insert signed transfer fee pending item: %w", err)
				}
			}
		}

		if ccEnabled && feeTreatment == "APARTE" && feeSettlement == "REAL" {
			if err := applyCCImpactTx(ctx, s.ccSvc, tx, clientID, input.Transfer.CurrencyID, feeStr, movementID, feeCCSide, "Transferencia — comisión", callerID); err != nil {
				return fmt.Errorf("apply signed transfer cc fee impact: %w", err)
			}
		}

		_, err = s.operationRepo.InsertProfitEntry(ctx, tx, movementID, input.Transfer.CurrencyID, feeProfitAmount, input.Transfer.AccountID, input.Transfer.Format)
		if err != nil {
			return fmt.Errorf("insert signed transfer profit fee: %w", err)
		}
	}

	if err := s.auditRepo.InsertTx(ctx, tx, "movement", &movementID, "transferencia",
		nil,
		map[string]interface{}{
			"model":           "SIGNED_TRANSFER",
			"direction":       side,
			"transfer_amount": input.Transfer.Amount,
			"transfer_abs":    absTransferStr,
			"currency_id":     input.Transfer.CurrencyID,
			"account_id":      input.Transfer.AccountID,
			"format":          input.Transfer.Format,
			"pending":         isPending,
			"fee_enabled":     input.Fee.Enabled,
			"fee_mode":        feeMode,
			"fee_treatment":   feeTreatment,
			"fee_payer":       feePayer,
			"fee_settlement":  feeSettlement,
			"fee_sign_legacy": legacyFeeSign, // Sign legacy en draft (PLUS/MINUS); no eliminar sin migrar datos.
			"fee_amount":      ratTrim(feeAmt),
			// payload_priority: modelo signed transfer vs. estructura antigua en borradores.
			"payload_priority": "transfer_over_legacy",
		},
		callerID); err != nil {
		return fmt.Errorf("insert signed transferencia audit: %w", err)
	}

	if err := confirmMovementDraftTx(ctx, tx, s.pool, s.operationRepo, s.auditRepo, movementID, callerID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func minRat(a, b *big.Rat) *big.Rat {
	if a.Cmp(b) <= 0 {
		return new(big.Rat).Set(a)
	}
	return new(big.Rat).Set(b)
}

func validFeeMode(v string) bool {
	return v == "PERCENT" || v == "FIXED"
}

func validFeeTreatment(v string) bool {
	return v == "APARTE" || v == "INCLUIDA"
}

func validFeePayer(v string) bool {
	return v == "CLIENTE_PAGA" || v == "NOSOTROS_PAGAMOS"
}

func validFeeSettlement(v string) bool {
	return v == "REAL" || v == "PENDIENTE"
}
