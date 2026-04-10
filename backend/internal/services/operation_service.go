package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"fina/internal/repositories"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrInvalidMovementType      = errors.New("INVALID_MOVEMENT_TYPE")
	ErrClientRequired           = errors.New("CLIENT_REQUIRED")
	ErrDateRequired             = errors.New("DATE_REQUIRED")
	ErrHandlerNotReady          = errors.New("HANDLER_NOT_READY")
	ErrMovementIDRequired       = errors.New("MOVEMENT_ID_REQUIRED")
	ErrDraftPayloadInvalid      = errors.New("DRAFT_PAYLOAD_INVALID")
	ErrMovementNotConfirmed     = errors.New("MOVEMENT_NOT_CONFIRMED")
	ErrMovementNotModifiable    = errors.New("MOVEMENT_NOT_MODIFIABLE")
	ErrMovementAlreadyCancelled = errors.New("MOVEMENT_ALREADY_CANCELLED")
	ErrMovementNotCancelled     = errors.New("MOVEMENT_NOT_CANCELLED")
	ErrPayloadClearConfirmationRequired = errors.New("PAYLOAD_CLEAR_CONFIRMATION_REQUIRED")
)

const (
	CorrectionModeModify   = "MODIFY"
	CorrectionModeRecreate = "RECREATE"
)

var validMovementTypes = map[string]bool{
	"COMPRA":                      true,
	"VENTA":                       true,
	"ARBITRAJE":                   true,
	"TRANSFERENCIA":               true,
	"TRANSFERENCIA_ENTRE_CUENTAS": true,
	"INGRESO_CAPITAL":             true,
	"RETIRO_CAPITAL":              true,
	"GASTO":                       true,
	"PAGO_CC_CRUZADO":             true,
	"TRASPASO_DEUDA_CC":           true,
}

var clientOptionalTypes = map[string]bool{
	"TRANSFERENCIA_ENTRE_CUENTAS": true,
	"GASTO":                       true,
}

type OperationService struct {
	pool          *pgxpool.Pool
	operationRepo *repositories.OperationRepo
	ccRepo        *repositories.CCRepo
	auditRepo     *repositories.AuditRepo
}

func NewOperationService(pool *pgxpool.Pool, operationRepo *repositories.OperationRepo, auditRepo *repositories.AuditRepo) *OperationService {
	return &OperationService{
		pool:          pool,
		operationRepo: operationRepo,
		ccRepo:        repositories.NewCCRepo(pool),
		auditRepo:     auditRepo,
	}
}

type CreateMovementInput struct {
	Type     string  `json:"type"`
	Date     string  `json:"date"`
	DayName  string  `json:"day_name"`
	ClientID *string `json:"client_id"`
}

type CreateMovementResult struct {
	ID              string `json:"id"`
	OperationNumber int64  `json:"operation_number"`
}

type SaveDraftInput struct {
	SchemaVersion int             `json:"schema_version"`
	OperationType string          `json:"operation_type"`
	Data          json.RawMessage `json:"data"`
}

type GetDraftResult struct {
	MovementID string          `json:"movement_id"`
	Payload    json.RawMessage `json:"payload"`
	UpdatedAt  string          `json:"updated_at"`
}

func (s *OperationService) CreateMovement(ctx context.Context, input CreateMovementInput, callerID string) (*CreateMovementResult, error) {
	if input.Date == "" {
		return nil, ErrDateRequired
	}
	if !validMovementTypes[input.Type] {
		return nil, ErrInvalidMovementType
	}
	clientRequired := !clientOptionalTypes[input.Type]
	if clientRequired && (input.ClientID == nil || *input.ClientID == "") {
		return nil, ErrClientRequired
	}

	if input.ClientID != nil && *input.ClientID != "" {
		if err := s.operationRepo.ValidateClientActive(ctx, *input.ClientID); err != nil {
			return nil, err
		}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var clientPtr *string
	if input.ClientID != nil && *input.ClientID != "" {
		clientPtr = input.ClientID
	}

	header, err := s.operationRepo.CreateMovementHeader(ctx, tx, input.Type, input.Date, input.DayName, clientPtr, callerID)
	if err != nil {
		return nil, fmt.Errorf("create header: %w", err)
	}

	if err := s.auditRepo.InsertTx(ctx, tx, "movement", &header.ID, "create_draft",
		nil,
		map[string]interface{}{
			"type":             input.Type,
			"date":             input.Date,
			"client_id":        input.ClientID,
			"status":           MovementStatusDraft,
			"operation_number": header.OperationNumber,
		},
		callerID); err != nil {
		return nil, fmt.Errorf("insert create_draft audit: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}

	return &CreateMovementResult{
		ID:              header.ID,
		OperationNumber: header.OperationNumber,
	}, nil
}

// PatchMovementHeaderInput updates header fields for a BORRADOR movement only.
// If type or client changes and a usable draft payload exists, ConfirmClearPayload must be true or ErrPayloadClearConfirmationRequired is returned.
type PatchMovementHeaderInput struct {
	Date                string  `json:"date"`
	Type                string  `json:"type"`
	ClientID            *string `json:"client_id"`
	ConfirmClearPayload bool    `json:"confirm_clear_payload"`
}

type PatchMovementHeaderResult struct {
	ID              string `json:"id"`
	OperationNumber int64  `json:"operation_number"`
	DraftCleared    bool   `json:"draft_cleared"`
}

func computeDayNameES(dateStr string) (string, error) {
	t, err := time.Parse("2006-01-02", dateStr)
	if err != nil {
		return "", fmt.Errorf("invalid date")
	}
	names := []string{"Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"}
	return names[int(t.Weekday())], nil
}

// MovementDayNameES devuelve el nombre del día en español para una fecha YYYY-MM-DD (mismo criterio que encabezados de movimiento).
func MovementDayNameES(dateStr string) (string, error) {
	return computeDayNameES(dateStr)
}

func movementDraftHasUsablePayload(payloadJSON string) bool {
	if strings.TrimSpace(payloadJSON) == "" {
		return false
	}
	var parsed map[string]interface{}
	if json.Unmarshal([]byte(payloadJSON), &parsed) != nil {
		return false
	}
	return isDraftDataUsable(parsed["data"])
}

func (s *OperationService) PatchMovementHeader(ctx context.Context, movementID string, input PatchMovementHeaderInput, callerID string) (*PatchMovementHeaderResult, error) {
	if movementID == "" {
		return nil, ErrMovementIDRequired
	}
	if input.Date == "" {
		return nil, ErrDateRequired
	}
	if !validMovementTypes[input.Type] {
		return nil, ErrInvalidMovementType
	}
	clientRequired := !clientOptionalTypes[input.Type]
	if clientRequired && (input.ClientID == nil || *input.ClientID == "") {
		return nil, ErrClientRequired
	}
	var clientPtr *string
	if input.ClientID != nil && *input.ClientID != "" {
		if err := s.operationRepo.ValidateClientActive(ctx, *input.ClientID); err != nil {
			return nil, err
		}
		clientPtr = input.ClientID
	}

	dayName, err := computeDayNameES(input.Date)
	if err != nil {
		return nil, ErrDateRequired
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	meta, err := s.operationRepo.GetMovementMetaTx(ctx, tx, movementID)
	if err != nil {
		return nil, err
	}
	if meta.Status != MovementStatusDraft {
		return nil, ErrMovementNotDraft
	}

	typeChanged := meta.Type != input.Type
	clientChanged := normalizeClientIDPtr(meta.ClientID) != normalizeClientIDPtr(clientPtr)
	needsClear := (typeChanged || clientChanged)

	var draftPayload string
	payloadPtr, perr := s.operationRepo.GetMovementDraftPayloadTx(ctx, tx, movementID)
	if perr != nil {
		return nil, perr
	}
	if payloadPtr != nil {
		draftPayload = *payloadPtr
	}
	hasPayload := movementDraftHasUsablePayload(draftPayload)

	if needsClear && hasPayload && !input.ConfirmClearPayload {
		return nil, ErrPayloadClearConfirmationRequired
	}

	before := map[string]interface{}{
		"type":      meta.Type,
		"date":      meta.Date,
		"client_id": meta.ClientID,
	}
	after := map[string]interface{}{
		"type":      input.Type,
		"date":      input.Date,
		"client_id": clientPtr,
	}

	draftCleared := false
	if needsClear && hasPayload && input.ConfirmClearPayload {
		reasons := []string{}
		if typeChanged {
			reasons = append(reasons, "TYPE_CHANGED")
		}
		if clientChanged {
			reasons = append(reasons, "CLIENT_CHANGED")
		}
		if err := s.operationRepo.DeleteMovementDraftTx(ctx, tx, movementID); err != nil {
			return nil, fmt.Errorf("delete movement draft: %w", err)
		}
		draftCleared = true
		if err := s.auditRepo.InsertTx(ctx, tx, "movement", &movementID, "draft_payload_cleared",
			map[string]interface{}{"reasons": reasons, "before_header": before},
			map[string]interface{}{"cleared": true},
			callerID); err != nil {
			return nil, fmt.Errorf("audit draft_payload_cleared: %w", err)
		}
	}

	if err := s.operationRepo.UpdateMovementHeaderTx(ctx, tx, movementID, input.Type, input.Date, dayName, clientPtr); err != nil {
		if errors.Is(err, repositories.ErrNotFound) {
			return nil, ErrMovementNotDraft
		}
		return nil, fmt.Errorf("update header: %w", err)
	}

	if err := s.auditRepo.InsertTx(ctx, tx, "movement", &movementID, "update_draft_header",
		before,
		after,
		callerID); err != nil {
		return nil, fmt.Errorf("audit update_draft_header: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}

	return &PatchMovementHeaderResult{
		ID:              movementID,
		OperationNumber: meta.OperationNumber,
		DraftCleared:    draftCleared,
	}, nil
}

func normalizeClientIDPtr(p *string) string {
	if p == nil || *p == "" {
		return ""
	}
	return *p
}

func (s *OperationService) DiscardMovementDraft(ctx context.Context, movementID, callerID string) error {
	if movementID == "" {
		return ErrMovementIDRequired
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var currentStatus string
	err = tx.QueryRow(ctx, `SELECT status FROM movements WHERE id = $1`, movementID).Scan(&currentStatus)
	if err != nil {
		return repositories.ErrNotFound
	}
	if currentStatus != MovementStatusDraft {
		return ErrMovementNotDraft
	}

	correction, err := s.operationRepo.GetMovementCorrectionByDraftTx(ctx, tx, movementID)
	if err != nil {
		return fmt.Errorf("get movement correction by draft: %w", err)
	}
	if correction != nil && correction.Status == "PENDING" {
		if err := s.auditRepo.InsertTx(ctx, tx, "movement", &correction.SourceMovementID, "discard_correction_draft",
			nil,
			map[string]interface{}{
				"mode":               correction.Mode,
				"source_movement_id": correction.SourceMovementID,
				"discarded_draft_id": correction.DraftMovementID,
			},
			callerID); err != nil {
			return fmt.Errorf("insert discard_correction_draft audit: %w", err)
		}
	}

	deleted, err := s.operationRepo.DeleteMovementByIDTx(ctx, tx, movementID)
	if err != nil {
		return fmt.Errorf("discard movement draft: %w", err)
	}
	if !deleted {
		return repositories.ErrNotFound
	}
	return tx.Commit(ctx)
}

func (s *OperationService) SaveMovementDraft(ctx context.Context, movementID string, input SaveDraftInput, callerID string) error {
	if movementID == "" {
		return ErrMovementIDRequired
	}
	if input.SchemaVersion <= 0 || input.OperationType == "" || len(input.Data) == 0 || !json.Valid(input.Data) {
		return ErrDraftPayloadInvalid
	}

	var movType, movStatus string
	err := s.pool.QueryRow(ctx, `SELECT type, status FROM movements WHERE id = $1`, movementID).Scan(&movType, &movStatus)
	if err != nil {
		return repositories.ErrNotFound
	}
	if movStatus != MovementStatusDraft {
		return ErrMovementNotDraft
	}
	if movType != input.OperationType {
		return ErrDraftPayloadInvalid
	}

	payloadMap := map[string]interface{}{
		"schema_version": input.SchemaVersion,
		"operation_type": input.OperationType,
		"data":           json.RawMessage(input.Data),
	}
	if existingDraft, err := s.operationRepo.GetMovementDraft(ctx, movementID); err == nil {
		var existing map[string]interface{}
		if json.Unmarshal([]byte(existingDraft.Payload), &existing) == nil {
			if correction, ok := existing["correction"]; ok {
				payloadMap["correction"] = correction
			}
		}
	}

	payload, err := json.Marshal(payloadMap)
	if err != nil {
		return ErrDraftPayloadInvalid
	}

	if err := s.operationRepo.UpsertMovementDraft(ctx, movementID, string(payload), callerID); err != nil {
		return fmt.Errorf("upsert movement draft: %w", err)
	}
	return nil
}

func (s *OperationService) GetMovementDraft(ctx context.Context, movementID string) (*GetDraftResult, error) {
	if movementID == "" {
		return nil, ErrMovementIDRequired
	}

	var movStatus string
	err := s.pool.QueryRow(ctx, `SELECT status FROM movements WHERE id = $1`, movementID).Scan(&movStatus)
	if err != nil {
		return nil, repositories.ErrNotFound
	}
	if movStatus != MovementStatusDraft {
		return nil, ErrMovementNotDraft
	}

	row, err := s.operationRepo.GetMovementDraft(ctx, movementID)
	if err != nil {
		return nil, err
	}
	return &GetDraftResult{
		MovementID: row.MovementID,
		Payload:    json.RawMessage([]byte(row.Payload)),
		UpdatedAt:  row.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}, nil
}

func (s *OperationService) StartModifyFromConfirmed(ctx context.Context, movementID, callerID string) (*CreateMovementResult, error) {
	return s.startCorrectionDraft(ctx, movementID, callerID, CorrectionModeModify)
}

func (s *OperationService) StartRecreateFromCancelled(ctx context.Context, movementID, callerID string) (*CreateMovementResult, error) {
	return s.startCorrectionDraft(ctx, movementID, callerID, CorrectionModeRecreate)
}

func (s *OperationService) startCorrectionDraft(ctx context.Context, movementID, callerID, mode string) (*CreateMovementResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	meta, err := s.operationRepo.GetMovementMetaTx(ctx, tx, movementID)
	if err != nil {
		return nil, err
	}
	if mode == CorrectionModeModify && meta.Status != MovementStatusConfirmed {
		return nil, ErrMovementNotModifiable
	}
	if mode == CorrectionModeRecreate && meta.Status != MovementStatusCancelled {
		return nil, ErrMovementNotCancelled
	}

	header, err := s.operationRepo.CreateMovementHeader(ctx, tx, meta.Type, meta.Date, meta.DayName, meta.ClientID, callerID)
	if err != nil {
		return nil, fmt.Errorf("create correction header: %w", err)
	}

	payload, err := s.operationRepo.GetMovementDraftPayloadTx(ctx, tx, movementID)
	if err != nil {
		return nil, fmt.Errorf("get source draft payload: %w", err)
	}
	correctionPayload, err := buildCorrectionPayloadTx(ctx, tx, s.operationRepo, meta, payload, mode)
	if err != nil {
		return nil, fmt.Errorf("build correction payload: %w", err)
	}
	if err := s.operationRepo.UpsertMovementDraftTx(ctx, tx, header.ID, correctionPayload, callerID); err != nil {
		return nil, fmt.Errorf("upsert correction draft payload: %w", err)
	}
	if err := s.operationRepo.CreateMovementCorrectionTx(ctx, tx, movementID, header.ID, mode, callerID); err != nil {
		return nil, fmt.Errorf("create movement correction link: %w", err)
	}

	if err := s.auditRepo.InsertTx(ctx, tx, "movement", &movementID, "start_correction",
		map[string]interface{}{"status": meta.Status},
		map[string]interface{}{
			"mode":                     mode,
			"source_operation_number":  meta.OperationNumber,
			"correction_movement_id":   header.ID,
			"correction_operation_num": header.OperationNumber,
		},
		callerID); err != nil {
		return nil, fmt.Errorf("insert start_correction audit: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit correction draft: %w", err)
	}
	return &CreateMovementResult{ID: header.ID, OperationNumber: header.OperationNumber}, nil
}

func buildCorrectionPayloadTx(ctx context.Context, tx pgx.Tx, opRepo *repositories.OperationRepo, meta *repositories.MovementMeta, sourcePayload *string, mode string) (string, error) {
	base := map[string]interface{}{
		"schema_version": 1,
		"operation_type": meta.Type,
		"data":           map[string]interface{}{},
	}
	var parsed map[string]interface{}
	usedHistoricalReconstruction := false

	if sourcePayload != nil && *sourcePayload != "" {
		if err := json.Unmarshal([]byte(*sourcePayload), &parsed); err == nil {
			if isDraftDataUsable(parsed["data"]) {
				base = parsed
			}
		}
	}

	if !isDraftDataUsable(base["data"]) {
		reconstructed, manualFields, err := reconstructDraftDataFromMovementTx(ctx, tx, opRepo, meta)
		if err != nil {
			return "", err
		}
		base["data"] = reconstructed
		usedHistoricalReconstruction = true
		if len(manualFields) > 0 {
			base["reconstruction"] = map[string]interface{}{
				"source":        "historical",
				"manual_fields": manualFields,
				"message":       "Se precargaron datos desde histórico. Algunos campos requieren revisión manual.",
			}
		} else {
			base["reconstruction"] = map[string]interface{}{
				"source":  "historical",
				"message": "Se precargaron datos desde histórico.",
			}
		}
	}

	base["correction"] = map[string]interface{}{
		"mode":                    mode,
		"source_movement_id":      meta.ID,
		"source_operation_number": meta.OperationNumber,
	}
	if usedHistoricalReconstruction {
		base["reconstruction_fallback"] = true
	}

	raw, err := json.Marshal(base)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func isDraftDataUsable(data interface{}) bool {
	m, ok := data.(map[string]interface{})
	if !ok || len(m) == 0 {
		return false
	}
	for _, v := range m {
		switch t := v.(type) {
		case string:
			if strings.TrimSpace(t) != "" {
				return true
			}
		case bool:
			if t {
				return true
			}
		case float64:
			if t != 0 {
				return true
			}
		case map[string]interface{}:
			if isDraftDataUsable(t) {
				return true
			}
		case []interface{}:
			if len(t) > 0 {
				return true
			}
		}
	}
	return false
}

func reconstructDraftDataFromMovementTx(ctx context.Context, tx pgx.Tx, opRepo *repositories.OperationRepo, meta *repositories.MovementMeta) (map[string]interface{}, []string, error) {
	lines, err := opRepo.ListMovementLinesTx(ctx, tx, meta.ID)
	if err != nil {
		return nil, nil, err
	}
	ccEntries, err := opRepo.ListMovementCCEntriesTx(ctx, tx, meta.ID)
	if err != nil {
		return nil, nil, err
	}
	profitEntries, err := opRepo.ListMovementProfitEntriesTx(ctx, tx, meta.ID)
	if err != nil {
		return nil, nil, err
	}

	switch meta.Type {
	case "COMPRA":
		return reconstructCompraDraftData(ctx, tx, meta.ID, lines)
	case "VENTA":
		return reconstructVentaDraftData(ctx, tx, meta.ID, lines)
	case "ARBITRAJE":
		return reconstructArbitrajeDraftData(lines, profitEntries), nil, nil
	case "TRANSFERENCIA_ENTRE_CUENTAS":
		return reconstructTransferenciaEntreCuentasDraftData(lines)
	case "INGRESO_CAPITAL":
		return reconstructSingleLineDraftData(lines, "IN")
	case "RETIRO_CAPITAL":
		return reconstructSingleLineDraftData(lines, "OUT")
	case "GASTO":
		return reconstructSingleLineDraftData(lines, "OUT")
	case "PAGO_CC_CRUZADO":
		return reconstructPagoCCCruzadoDraftData(lines, ccEntries)
	case "TRASPASO_DEUDA_CC":
		return reconstructTraspasoDeudaCCDraftData(meta.ClientID, ccEntries)
	case "TRANSFERENCIA":
		return reconstructTransferenciaDraftData(ctx, tx, meta.ID, lines, profitEntries)
	default:
		return map[string]interface{}{}, []string{"data"}, nil
	}
}

func reconstructSingleLineDraftData(lines []repositories.MovementLineRow, side string) (map[string]interface{}, []string, error) {
	for _, l := range lines {
		if l.Side != side {
			continue
		}
		return map[string]interface{}{
			"accountId":  l.AccountID,
			"currencyId": l.CurrencyID,
			"format":     l.Format,
			"amount":     l.Amount,
			"note":       "",
		}, nil, nil
	}
	return map[string]interface{}{}, []string{"accountId", "currencyId", "amount"}, nil
}

func reconstructTransferenciaEntreCuentasDraftData(lines []repositories.MovementLineRow) (map[string]interface{}, []string, error) {
	var outLine *repositories.MovementLineRow
	var inLine *repositories.MovementLineRow
	for i := range lines {
		l := lines[i]
		if l.Side == "OUT" && outLine == nil {
			outLine = &l
		}
		if l.Side == "IN" && inLine == nil {
			inLine = &l
		}
	}
	manualFields := []string{}
	if outLine == nil {
		manualFields = append(manualFields, "fromAccountId", "fromCurrencyId", "fromAmount")
	}
	if inLine == nil {
		manualFields = append(manualFields, "toAccountId")
	}
	data := map[string]interface{}{
		"fromAccountId":  "",
		"fromCurrencyId": "",
		"fromFormat":     "CASH",
		"fromAmount":     "",
		"toAccountId":    "",
		"toFormat":       "CASH",
	}
	if outLine != nil {
		data["fromAccountId"] = outLine.AccountID
		data["fromCurrencyId"] = outLine.CurrencyID
		data["fromFormat"] = outLine.Format
		data["fromAmount"] = outLine.Amount
	}
	if inLine != nil {
		data["toAccountId"] = inLine.AccountID
		data["toFormat"] = inLine.Format
	}
	return data, manualFields, nil
}

func reconstructPagoCCCruzadoDraftData(lines []repositories.MovementLineRow, ccEntries []repositories.MovementCCEntryRow) (map[string]interface{}, []string, error) {
	data := map[string]interface{}{
		"payAccountId":   "",
		"payCurrencyId":  "",
		"payFormat":      "CASH",
		"payAmount":      "",
		"debtCurrencyId": "",
		"cancelAmount":   "",
		"mode":           "ENTRA",
	}
	manualFields := []string{}

	var realLine *repositories.MovementLineRow
	for i := range lines {
		l := lines[i]
		if l.IsPending {
			continue
		}
		realLine = &l
		break
	}
	if realLine != nil {
		data["payAccountId"] = realLine.AccountID
		data["payCurrencyId"] = realLine.CurrencyID
		data["payFormat"] = realLine.Format
		data["payAmount"] = realLine.Amount
		if realLine.Side == "OUT" {
			data["mode"] = "SALE"
		}
	} else {
		manualFields = append(manualFields, "payAccountId", "payCurrencyId", "payAmount")
	}

	if len(ccEntries) > 0 {
		ce := ccEntries[0]
		data["debtCurrencyId"] = ce.CurrencyID
		amt, err := absAmount(ce.Amount)
		if err != nil {
			manualFields = append(manualFields, "cancelAmount")
		} else {
			data["cancelAmount"] = amt
		}
	} else {
		manualFields = append(manualFields, "debtCurrencyId", "cancelAmount")
	}

	return data, manualFields, nil
}

func reconstructTraspasoDeudaCCDraftData(sourceClientID *string, ccEntries []repositories.MovementCCEntryRow) (map[string]interface{}, []string, error) {
	data := map[string]interface{}{
		"toClientId": "",
		"currencyId": "",
		"amount":     "",
		"note":       "",
	}
	manualFields := []string{}
	if len(ccEntries) == 0 {
		return data, []string{"toClientId", "currencyId", "amount"}, nil
	}
	fromClient := ""
	if sourceClientID != nil {
		fromClient = *sourceClientID
	}
	for _, ce := range ccEntries {
		if ce.ClientID != "" && ce.ClientID != fromClient {
			data["toClientId"] = ce.ClientID
			data["currencyId"] = ce.CurrencyID
			amt, err := absAmount(ce.Amount)
			if err == nil {
				data["amount"] = amt
			} else {
				manualFields = append(manualFields, "amount")
			}
			return data, manualFields, nil
		}
	}
	return data, []string{"toClientId", "currencyId", "amount"}, nil
}

func reconstructArbitrajeDraftData(lines []repositories.MovementLineRow, profitEntries []repositories.MovementProfitEntryRow) map[string]interface{} {
	data := map[string]interface{}{
		"costoAccountId":    "",
		"costoCurrencyId":   "",
		"costoFormat":       "CASH",
		"costoAmount":       "",
		"costoPending":      false,
		"cobradoAccountId":  "",
		"cobradoCurrencyId": "",
		"cobradoFormat":     "CASH",
		"cobradoAmount":     "",
		"cobradoPending":    false,
		"profitAccountId":   "",
		"profitCurrencyId":  "",
		"profitFormat":      "CASH",
		"profitManual":      "",
		"profitOverride":    false,
	}
	for _, l := range lines {
		if l.Side == "OUT" && data["costoAccountId"] == "" {
			data["costoAccountId"] = l.AccountID
			data["costoCurrencyId"] = l.CurrencyID
			data["costoFormat"] = l.Format
			data["costoAmount"] = l.Amount
			data["costoPending"] = l.IsPending
			continue
		}
		if l.Side == "IN" && data["cobradoAccountId"] == "" {
			data["cobradoAccountId"] = l.AccountID
			data["cobradoCurrencyId"] = l.CurrencyID
			data["cobradoFormat"] = l.Format
			data["cobradoAmount"] = l.Amount
			data["cobradoPending"] = l.IsPending
		}
	}
	if len(profitEntries) > 0 {
		pe := profitEntries[0]
		data["profitAccountId"] = pe.AccountID
		data["profitCurrencyId"] = pe.CurrencyID
		data["profitFormat"] = pe.Format
		data["profitManual"] = pe.Amount
		data["profitOverride"] = true
	}
	return data
}

func reconstructCompraDraftData(ctx context.Context, tx pgx.Tx, movementID string, lines []repositories.MovementLineRow) (map[string]interface{}, []string, error) {
	data := map[string]interface{}{
		"inAccountId":        "",
		"inCurrencyId":       "",
		"inFormat":           "CASH",
		"inAmount":           "",
		"inPending":          false,
		"quoteRate":          "",
		"quoteCurrencyId":    "",
		"quoteMode":          "MULTIPLY",
		"outs":               []map[string]interface{}{},
		"firstOutAmountMode": "MANUAL",
	}
	var inLine *repositories.MovementLineRow
	var outLines []repositories.MovementLineRow
	for i := range lines {
		l := lines[i]
		if l.Side == "IN" && inLine == nil {
			inLine = &l
			continue
		}
		if l.Side == "OUT" {
			outLines = append(outLines, l)
		}
	}
	manualFields := []string{}
	if inLine == nil {
		manualFields = append(manualFields, "inAccountId", "inCurrencyId", "inAmount")
	} else {
		data["inAccountId"] = inLine.AccountID
		data["inCurrencyId"] = inLine.CurrencyID
		data["inFormat"] = inLine.Format
		data["inAmount"] = inLine.Amount
		data["inPending"] = inLine.IsPending
	}
	if len(outLines) == 0 {
		manualFields = append(manualFields, "outs")
	}
	outs := make([]map[string]interface{}, 0, len(outLines))
	sumOut := new(big.Rat)
	for _, out := range outLines {
		outs = append(outs, map[string]interface{}{
			"accountId":   out.AccountID,
			"format":      out.Format,
			"amount":      out.Amount,
			"pendingCash": out.IsPending,
		})
		if amt, ok := new(big.Rat).SetString(out.Amount); ok {
			sumOut.Add(sumOut, amt)
		}
		data["quoteCurrencyId"] = out.CurrencyID
	}
	data["outs"] = outs

	after, ok, err := getMovementAuditAfterTx(ctx, tx, movementID, "compra")
	if err != nil {
		return nil, nil, err
	}
	if ok {
		if v := mapString(after, "quote_rate"); v != "" {
			data["quoteRate"] = v
		}
		if v := mapString(after, "quote_currency"); v != "" {
			data["quoteCurrencyId"] = v
		}
		if v := mapString(after, "quote_mode"); v != "" {
			data["quoteMode"] = v
		}
	}
	if data["quoteRate"] == "" && inLine != nil && sumOut.Sign() > 0 {
		inAmt, ok := new(big.Rat).SetString(inLine.Amount)
		if ok && inAmt.Sign() > 0 {
			r := new(big.Rat).Quo(sumOut, inAmt)
			data["quoteRate"] = ratTrim(r)
			manualFields = append(manualFields, "quoteMode")
		}
	}

	return data, uniqueStrings(manualFields), nil
}

func reconstructVentaDraftData(ctx context.Context, tx pgx.Tx, movementID string, lines []repositories.MovementLineRow) (map[string]interface{}, []string, error) {
	data := map[string]interface{}{
		"outAccountId":      "",
		"outCurrencyId":     "",
		"outFormat":         "CASH",
		"outAmount":         "",
		"outPending":        false,
		"quoteRate":         "",
		"quoteCurrencyId":   "",
		"quoteMode":         "MULTIPLY",
		"ins":               []map[string]interface{}{},
		"firstInAmountMode": "MANUAL",
	}
	var outLine *repositories.MovementLineRow
	var inLines []repositories.MovementLineRow
	for i := range lines {
		l := lines[i]
		if l.Side == "OUT" && outLine == nil {
			outLine = &l
			continue
		}
		if l.Side == "IN" {
			inLines = append(inLines, l)
		}
	}
	manualFields := []string{}
	if outLine == nil {
		manualFields = append(manualFields, "outAccountId", "outCurrencyId", "outAmount")
	} else {
		data["outAccountId"] = outLine.AccountID
		data["outCurrencyId"] = outLine.CurrencyID
		data["outFormat"] = outLine.Format
		data["outAmount"] = outLine.Amount
		data["outPending"] = outLine.IsPending
	}
	if len(inLines) == 0 {
		manualFields = append(manualFields, "ins")
	}
	ins := make([]map[string]interface{}, 0, len(inLines))
	sumIn := new(big.Rat)
	for _, inL := range inLines {
		ins = append(ins, map[string]interface{}{
			"accountId":   inL.AccountID,
			"format":      inL.Format,
			"amount":      inL.Amount,
			"pendingCash": inL.IsPending,
		})
		if amt, ok := new(big.Rat).SetString(inL.Amount); ok {
			sumIn.Add(sumIn, amt)
		}
		data["quoteCurrencyId"] = inL.CurrencyID
	}
	data["ins"] = ins

	after, ok, err := getMovementAuditAfterTx(ctx, tx, movementID, "venta")
	if err != nil {
		return nil, nil, err
	}
	if ok {
		if v := mapString(after, "quote_rate"); v != "" {
			data["quoteRate"] = v
		}
		if v := mapString(after, "quote_currency"); v != "" {
			data["quoteCurrencyId"] = v
		}
		if v := mapString(after, "quote_mode"); v != "" {
			data["quoteMode"] = v
		}
	}
	if data["quoteRate"] == "" && outLine != nil && sumIn.Sign() > 0 {
		outAmt, ok := new(big.Rat).SetString(outLine.Amount)
		if ok && outAmt.Sign() > 0 {
			r := new(big.Rat).Quo(sumIn, outAmt)
			data["quoteRate"] = ratTrim(r)
			manualFields = append(manualFields, "quoteMode")
		}
	}

	return data, uniqueStrings(manualFields), nil
}

func reconstructTransferenciaDraftData(ctx context.Context, tx pgx.Tx, movementID string, lines []repositories.MovementLineRow, profitEntries []repositories.MovementProfitEntryRow) (map[string]interface{}, []string, error) {
	data := map[string]interface{}{
		"delivery": map[string]interface{}{
			"account_id":  "",
			"currency_id": "",
			"format":      "CASH",
			"amount":      "",
			"settlement":  "REAL",
		},
		"collections": []map[string]interface{}{},
		"feeEnabled":  false,
		"feeMode":     "FIXED",
		"feeValue":    "",
		"feeSign":     "PLUS",
	}
	manualFields := []string{}
	var outLine *repositories.MovementLineRow
	var inLines []repositories.MovementLineRow
	for i := range lines {
		l := lines[i]
		if l.Side == "OUT" && outLine == nil {
			outLine = &l
			continue
		}
		if l.Side == "IN" {
			inLines = append(inLines, l)
		}
	}
	if outLine == nil {
		manualFields = append(manualFields, "delivery")
	} else {
		data["delivery"] = map[string]interface{}{
			"account_id":  outLine.AccountID,
			"currency_id": outLine.CurrencyID,
			"format":      outLine.Format,
			"amount":      outLine.Amount,
			"settlement":  settlementFromPending(outLine.IsPending),
		}
	}
	collections := make([]map[string]interface{}, 0, len(inLines))
	for _, l := range inLines {
		collections = append(collections, map[string]interface{}{
			"settlement":  settlementFromPending(l.IsPending),
			"account_id":  l.AccountID,
			"currency_id": l.CurrencyID,
			"format":      l.Format,
			"amount":      l.Amount,
		})
	}
	if len(collections) == 0 {
		collections = append(collections, map[string]interface{}{
			"settlement":  "REAL",
			"account_id":  "",
			"currency_id": "",
			"format":      "CASH",
			"amount":      "",
		})
		manualFields = append(manualFields, "collections")
	}
	data["collections"] = collections

	totalFee := new(big.Rat)
	for _, pe := range profitEntries {
		if amt, ok := new(big.Rat).SetString(pe.Amount); ok {
			if amt.Sign() < 0 {
				amt.Neg(amt)
			}
			totalFee.Add(totalFee, amt)
		}
	}
	if totalFee.Sign() > 0 {
		data["feeEnabled"] = true
		data["feeMode"] = "FIXED"
		data["feeValue"] = ratTrim(totalFee)
	}

	after, ok, err := getMovementAuditAfterTx(ctx, tx, movementID, "transferencia")
	if err != nil {
		return nil, nil, err
	}
	if ok {
		deliverySettlement := mapString(after, "delivery_settlement")
		if deliverySettlement != "" {
			if dm, ok := data["delivery"].(map[string]interface{}); ok {
				dm["settlement"] = deliverySettlement
				data["delivery"] = dm
			}
		}
		feeEnabled := mapBool(after, "fee_enabled")
		if feeEnabled {
			data["feeEnabled"] = true
			if fv := mapString(after, "fee_expected"); fv != "" {
				data["feeValue"] = fv
			}
		}
		// Infer sign by comparing input vs net delivery from audit.
		deliveryIn := mapRat(after, "delivery_amount_in")
		deliveryOut := mapRat(after, "delivery_out")
		if deliveryIn != nil && deliveryOut != nil && deliveryIn.Cmp(deliveryOut) > 0 {
			data["feeSign"] = "MINUS"
		}
	}
	if data["feeEnabled"].(bool) && data["feeValue"] == "" {
		manualFields = append(manualFields, "feeValue")
	}
	return data, uniqueStrings(manualFields), nil
}

func getMovementAuditAfterTx(ctx context.Context, tx pgx.Tx, movementID, action string) (map[string]interface{}, bool, error) {
	var raw string
	err := tx.QueryRow(ctx,
		`SELECT after_json::text
		 FROM audit_logs
		 WHERE entity_type = 'movement'
		   AND entity_id::text = $1
		   AND action = $2
		 ORDER BY created_at DESC
		 LIMIT 1`,
		movementID, action).Scan(&raw)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, false, nil
		}
		return nil, false, err
	}
	var m map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return nil, false, nil
	}
	return m, true, nil
}

func mapString(m map[string]interface{}, key string) string {
	if m == nil {
		return ""
	}
	if v, ok := m[key]; ok {
		switch t := v.(type) {
		case string:
			return t
		case float64:
			return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.8f", t), "0"), ".")
		}
	}
	return ""
}

func mapBool(m map[string]interface{}, key string) bool {
	if m == nil {
		return false
	}
	if v, ok := m[key].(bool); ok {
		return v
	}
	return false
}

func mapRat(m map[string]interface{}, key string) *big.Rat {
	if m == nil {
		return nil
	}
	raw, ok := m[key]
	if !ok {
		return nil
	}
	switch t := raw.(type) {
	case string:
		if r, ok := new(big.Rat).SetString(t); ok {
			return r
		}
	case float64:
		return new(big.Rat).SetFloat64(t)
	}
	return nil
}

func settlementFromPending(isPending bool) string {
	if isPending {
		return "OWED_PENDING"
	}
	return "REAL"
}

func absAmount(value string) (string, error) {
	r, ok := new(big.Rat).SetString(value)
	if !ok {
		return "", fmt.Errorf("invalid amount")
	}
	if r.Sign() < 0 {
		r.Neg(r)
	}
	return ratTrimLocal(r), nil
}

func ratTrimLocal(r *big.Rat) string {
	return strings.TrimRight(strings.TrimRight(r.FloatString(8), "0"), ".")
}

func uniqueStrings(values []string) []string {
	if len(values) == 0 {
		return values
	}
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, v := range values {
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	return out
}

func (s *OperationService) CancelMovement(ctx context.Context, movementID, callerID string) error {
	if movementID == "" {
		return ErrMovementIDRequired
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	if err := cancelMovementWithinTx(ctx, tx, s.operationRepo, s.ccRepo, s.auditRepo, movementID, callerID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func reverseSignedAmount(amount string) (string, error) {
	r, ok := new(big.Rat).SetString(amount)
	if !ok {
		return "", fmt.Errorf("invalid signed amount: %s", amount)
	}
	r.Neg(r)
	return strings.TrimRight(strings.TrimRight(r.FloatString(8), "0"), "."), nil
}

func validateZeroNetByMovementTx(ctx context.Context, tx pgx.Tx, movementID string) error {
	rows, err := tx.Query(ctx,
		`SELECT account_id::text, currency_id::text, format,
		        SUM(CASE WHEN side='IN' THEN amount ELSE -amount END)::text
		 FROM movement_lines
		 WHERE movement_id = $1 AND is_pending = false
		 GROUP BY account_id, currency_id, format
		 HAVING SUM(CASE WHEN side='IN' THEN amount ELSE -amount END) <> 0`,
		movementID)
	if err != nil {
		return fmt.Errorf("validate real net: %w", err)
	}
	defer rows.Close()
	if rows.Next() {
		return errors.New("CANCEL_NET_REAL_NOT_ZERO")
	}
	if err := rows.Err(); err != nil {
		return err
	}

	rowsCC, err := tx.Query(ctx,
		`SELECT client_id::text, currency_id::text, SUM(amount)::text
		 FROM cc_entries
		 WHERE movement_id = $1
		 GROUP BY client_id, currency_id
		 HAVING SUM(amount) <> 0`,
		movementID)
	if err != nil {
		return fmt.Errorf("validate cc net: %w", err)
	}
	defer rowsCC.Close()
	if rowsCC.Next() {
		return errors.New("CANCEL_NET_CC_NOT_ZERO")
	}
	return rowsCC.Err()
}
