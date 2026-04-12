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
	// ErrFXFunctionalCurrencyUnset falta system_settings fx_functional_currency_code.
	ErrFXFunctionalCurrencyUnset = errors.New("FX_FUNCTIONAL_CURRENCY_UNSET")
	// ErrFXQuoteNotFunctional la cotización del movimiento no está en la moneda funcional configurada.
	ErrFXQuoteNotFunctional = errors.New("FX_QUOTE_CURRENCY_NOT_FUNCTIONAL")
	// ErrFXInsufficientInventory venta superior al stock disponible.
	ErrFXInsufficientInventory = errors.New("FX_INSUFFICIENT_INVENTORY")
	// ErrFXInvalidMovementLines estructura IN/OUT incompatible con COMPRA/VENTA.
	ErrFXInvalidMovementLines = errors.New("FX_INVALID_MOVEMENT_LINES")
)

// FxInventoryService mantiene inventario FX (costo promedio) solo para COMPRA/VENTA confirmadas.
type FxInventoryService struct {
	pool    *pgxpool.Pool
	opRepo  *repositories.OperationRepo
}

func NewFxInventoryService(pool *pgxpool.Pool, opRepo *repositories.OperationRepo) *FxInventoryService {
	return &FxInventoryService{pool: pool, opRepo: opRepo}
}

// ApplyOnMovementConfirmed aplica efecto de inventario tras pasar a CONFIRMADA (misma transacción).
func (s *FxInventoryService) ApplyOnMovementConfirmed(ctx context.Context, tx pgx.Tx, movementID string) error {
	meta, err := s.opRepo.GetMovementMetaTx(ctx, tx, movementID)
	if err != nil {
		return err
	}
	if meta.Type != "COMPRA" && meta.Type != "VENTA" && meta.Type != "TRANSFERENCIA" {
		return nil
	}
	if meta.Status != MovementStatusConfirmed {
		return fmt.Errorf("fx inventory: movimiento no confirmado")
	}

	functionalID, err := s.loadFunctionalCurrencyIDTx(ctx, tx)
	if err != nil {
		return err
	}

	lines, err := s.opRepo.ListMovementLinesTx(ctx, tx, movementID)
	if err != nil {
		return err
	}

	switch meta.Type {
	case "COMPRA":
		return s.applyCompraTx(ctx, tx, movementID, functionalID, lines)
	case "VENTA":
		return s.applyVentaTx(ctx, tx, movementID, functionalID, lines)
	case "TRANSFERENCIA":
		principal, ok := transferenciaPrincipalLegLines(lines)
		if !ok {
			return nil
		}
		outCID := strings.TrimSpace(principal[0].CurrencyID)
		inCID := strings.TrimSpace(principal[1].CurrencyID)
		if outCID == inCID {
			return nil
		}
		if outCID != functionalID && inCID == functionalID {
			return s.applyVentaTx(ctx, tx, movementID, functionalID, principal)
		}
		if outCID == functionalID && inCID != functionalID {
			return s.applyCompraTx(ctx, tx, movementID, functionalID, principal)
		}
		return nil
	default:
		return nil
	}
}

// ReverseOnMovementCancelled revierte el APPLY antes de marcar CANCELADA (misma transacción).
func (s *FxInventoryService) ReverseOnMovementCancelled(ctx context.Context, tx pgx.Tx, movementID string) error {
	var tradedID, functionalID string
	var qtyDelta, costDelta, realized, avgBefore string
	err := tx.QueryRow(ctx,
		`SELECT traded_currency_id::text, functional_currency_id::text,
		        quantity_delta::text, cost_delta_functional::text,
		        realized_pnl_functional::text, avg_cost_before::text
		 FROM fx_inventory_ledger
		 WHERE movement_id = $1 AND effect = 'APPLY'`, movementID).
		Scan(&tradedID, &functionalID, &qtyDelta, &costDelta, &realized, &avgBefore)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}

	var alreadyReverse bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM fx_inventory_ledger WHERE movement_id = $1 AND effect = 'REVERSE')`,
		movementID).Scan(&alreadyReverse); err != nil {
		return err
	}
	if alreadyReverse {
		return nil
	}

	qd, _ := new(big.Rat).SetString(qtyDelta)
	cd, _ := new(big.Rat).SetString(costDelta)
	rl, _ := new(big.Rat).SetString(realized)
	qd.Neg(qd)
	cd.Neg(cd)
	rl.Neg(rl)

	if err := s.adjustPositionTx(ctx, tx, tradedID, qd, cd); err != nil {
		return err
	}

	_, err = tx.Exec(ctx,
		`INSERT INTO fx_inventory_ledger
		 (movement_id, effect, traded_currency_id, functional_currency_id,
		  quantity_delta, cost_delta_functional, realized_pnl_functional, avg_cost_before)
		 VALUES ($1::uuid, 'REVERSE', $2::uuid, $3::uuid, $4::numeric, $5::numeric, $6::numeric, $7::numeric)`,
		movementID, tradedID, functionalID,
		ratTrimForFX(qd), ratTrimForFX(cd), ratTrimForFX(rl), avgBefore)
	return err
}

func (s *FxInventoryService) loadFunctionalCurrencyIDTx(ctx context.Context, tx pgx.Tx) (string, error) {
	var raw string
	err := tx.QueryRow(ctx,
		`SELECT value_json::text FROM system_settings WHERE key = 'fx_functional_currency_code'`).Scan(&raw)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrFXFunctionalCurrencyUnset
		}
		return "", err
	}
	var code string
	if err := json.Unmarshal([]byte(raw), &code); err != nil || code == "" {
		return "", ErrFXFunctionalCurrencyUnset
	}
	var id string
	err = tx.QueryRow(ctx,
		`SELECT id::text FROM currencies WHERE UPPER(code) = UPPER($1) AND active = true`, code).Scan(&id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", fmt.Errorf("%w: código %q", ErrFXFunctionalCurrencyUnset, code)
		}
		return "", err
	}
	return id, nil
}

func (s *FxInventoryService) applyCompraTx(ctx context.Context, tx pgx.Tx, movementID, functionalID string, lines []repositories.MovementLineRow) error {
	if err := s.ensureNoApplyLedgerTx(ctx, tx, movementID); err != nil {
		return err
	}
	tradedID, tradedQty, quoteSum, quoteCID, err := aggregateCompraLines(lines)
	if err != nil {
		return err
	}
	if quoteCID != functionalID {
		return fmt.Errorf("%w: esperada moneda funcional", ErrFXQuoteNotFunctional)
	}

	posQty, posCost, err := s.lockPositionTx(ctx, tx, tradedID)
	if err != nil {
		return err
	}

	avgBefore := avgCost(posQty, posCost)
	newQty := new(big.Rat).Add(posQty, tradedQty)
	newCost := new(big.Rat).Add(posCost, quoteSum)

	if err := s.writePositionTx(ctx, tx, tradedID, newQty, newCost); err != nil {
		return err
	}

	_, err = tx.Exec(ctx,
		`INSERT INTO fx_inventory_ledger
		 (movement_id, effect, traded_currency_id, functional_currency_id,
		  quantity_delta, cost_delta_functional, realized_pnl_functional, avg_cost_before)
		 VALUES ($1::uuid, 'APPLY', $2::uuid, $3::uuid, $4::numeric, $5::numeric, 0, $6::numeric)`,
		movementID, tradedID, functionalID,
		ratTrimForFX(tradedQty), ratTrimForFX(quoteSum), ratTrimForFX(avgBefore))
	return err
}

func (s *FxInventoryService) applyVentaTx(ctx context.Context, tx pgx.Tx, movementID, functionalID string, lines []repositories.MovementLineRow) error {
	if err := s.ensureNoApplyLedgerTx(ctx, tx, movementID); err != nil {
		return err
	}
	tradedID, tradedQty, quoteSum, quoteCID, err := aggregateVentaLines(lines)
	if err != nil {
		return err
	}
	if quoteCID != functionalID {
		return fmt.Errorf("%w: esperada moneda funcional", ErrFXQuoteNotFunctional)
	}

	posQty, posCost, err := s.lockPositionTx(ctx, tx, tradedID)
	if err != nil {
		return err
	}
	if posQty.Sign() <= 0 || posQty.Cmp(tradedQty) < 0 {
		return fmt.Errorf("%w: stock %s venta %s", ErrFXInsufficientInventory, ratTrimForFX(posQty), ratTrimForFX(tradedQty))
	}

	avgBefore := avgCost(posQty, posCost)
	costRemoved := new(big.Rat).Mul(tradedQty, avgBefore)
	realized := new(big.Rat).Sub(quoteSum, costRemoved)

	newQty := new(big.Rat).Sub(posQty, tradedQty)
	newCost := new(big.Rat).Sub(posCost, costRemoved)
	if newQty.Sign() == 0 {
		newCost.SetInt64(0)
	}
	if newQty.Sign() < 0 || newCost.Sign() < 0 {
		return ErrFXInsufficientInventory
	}

	if err := s.writePositionTx(ctx, tx, tradedID, newQty, newCost); err != nil {
		return err
	}

	_, err = tx.Exec(ctx,
		`INSERT INTO fx_inventory_ledger
		 (movement_id, effect, traded_currency_id, functional_currency_id,
		  quantity_delta, cost_delta_functional, realized_pnl_functional, avg_cost_before)
		 VALUES ($1::uuid, 'APPLY', $2::uuid, $3::uuid, $4::numeric, $5::numeric, $6::numeric, $7::numeric)`,
		movementID, tradedID, functionalID,
		ratTrimForFX(new(big.Rat).Neg(tradedQty)), ratTrimForFX(new(big.Rat).Neg(costRemoved)), ratTrimForFX(realized), ratTrimForFX(avgBefore))
	return err
}

func (s *FxInventoryService) ensureNoApplyLedgerTx(ctx context.Context, tx pgx.Tx, movementID string) error {
	var n int
	err := tx.QueryRow(ctx,
		`SELECT 1 FROM fx_inventory_ledger WHERE movement_id = $1 AND effect = 'APPLY'`, movementID).Scan(&n)
	if err == nil {
		return fmt.Errorf("fx inventory: APPLY duplicado para movimiento %s", movementID)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	return nil
}

func (s *FxInventoryService) lockPositionTx(ctx context.Context, tx pgx.Tx, tradedID string) (*big.Rat, *big.Rat, error) {
	_, err := tx.Exec(ctx,
		`INSERT INTO fx_positions (traded_currency_id, quantity, total_cost_functional)
		 VALUES ($1::uuid, 0, 0)
		 ON CONFLICT (traded_currency_id) DO NOTHING`, tradedID)
	if err != nil {
		return nil, nil, err
	}

	var qStr, cStr string
	err = tx.QueryRow(ctx,
		`SELECT quantity::text, total_cost_functional::text
		 FROM fx_positions WHERE traded_currency_id = $1::uuid FOR UPDATE`, tradedID).Scan(&qStr, &cStr)
	if err != nil {
		return nil, nil, err
	}
	q, _ := new(big.Rat).SetString(qStr)
	c, _ := new(big.Rat).SetString(cStr)
	return q, c, nil
}

func (s *FxInventoryService) writePositionTx(ctx context.Context, tx pgx.Tx, tradedID string, qty, cost *big.Rat) error {
	_, err := tx.Exec(ctx,
		`UPDATE fx_positions SET quantity = $2::numeric, total_cost_functional = $3::numeric, updated_at = now()
		 WHERE traded_currency_id = $1::uuid`,
		tradedID, ratTrimForFX(qty), ratTrimForFX(cost))
	return err
}

func (s *FxInventoryService) adjustPositionTx(ctx context.Context, tx pgx.Tx, tradedID string, qtyDelta, costDelta *big.Rat) error {
	posQty, posCost, err := s.lockPositionTx(ctx, tx, tradedID)
	if err != nil {
		return err
	}
	newQty := new(big.Rat).Add(posQty, qtyDelta)
	newCost := new(big.Rat).Add(posCost, costDelta)
	if newQty.Sign() < 0 || newCost.Sign() < 0 {
		return fmt.Errorf("fx inventory: reversa deja posición negativa")
	}
	if newQty.Sign() == 0 {
		newCost.SetInt64(0)
	}
	return s.writePositionTx(ctx, tx, tradedID, newQty, newCost)
}

func avgCost(qty, cost *big.Rat) *big.Rat {
	if qty.Sign() == 0 {
		return new(big.Rat)
	}
	return new(big.Rat).Quo(new(big.Rat).Set(cost), qty)
}

func aggregateCompraLines(lines []repositories.MovementLineRow) (tradedID string, tradedSum, quoteSum *big.Rat, quoteCurrencyID string, err error) {
	tradedSum = new(big.Rat)
	quoteSum = new(big.Rat)
	var tradedSet, quoteSet bool
	for _, l := range lines {
		amt, ok := new(big.Rat).SetString(l.Amount)
		if !ok || amt.Sign() <= 0 {
			continue
		}
		switch l.Side {
		case "IN":
			if tradedSet && tradedID != l.CurrencyID {
				return "", nil, nil, "", ErrFXInvalidMovementLines
			}
			tradedSet = true
			tradedID = l.CurrencyID
			tradedSum.Add(tradedSum, amt)
		case "OUT":
			if quoteSet && quoteCurrencyID != l.CurrencyID {
				return "", nil, nil, "", ErrFXInvalidMovementLines
			}
			quoteSet = true
			quoteCurrencyID = l.CurrencyID
			quoteSum.Add(quoteSum, amt)
		}
	}
	if !tradedSet || !quoteSet || tradedSum.Sign() == 0 || quoteSum.Sign() == 0 {
		return "", nil, nil, "", ErrFXInvalidMovementLines
	}
	return tradedID, tradedSum, quoteSum, quoteCurrencyID, nil
}

func aggregateVentaLines(lines []repositories.MovementLineRow) (tradedID string, tradedSum, quoteSum *big.Rat, quoteCurrencyID string, err error) {
	tradedSum = new(big.Rat)
	quoteSum = new(big.Rat)
	var tradedSet, quoteSet bool
	for _, l := range lines {
		amt, ok := new(big.Rat).SetString(l.Amount)
		if !ok || amt.Sign() <= 0 {
			continue
		}
		switch l.Side {
		case "OUT":
			if tradedSet && tradedID != l.CurrencyID {
				return "", nil, nil, "", ErrFXInvalidMovementLines
			}
			tradedSet = true
			tradedID = l.CurrencyID
			tradedSum.Add(tradedSum, amt)
		case "IN":
			if quoteSet && quoteCurrencyID != l.CurrencyID {
				return "", nil, nil, "", ErrFXInvalidMovementLines
			}
			quoteSet = true
			quoteCurrencyID = l.CurrencyID
			quoteSum.Add(quoteSum, amt)
		}
	}
	if !tradedSet || !quoteSet || tradedSum.Sign() == 0 || quoteSum.Sign() == 0 {
		return "", nil, nil, "", ErrFXInvalidMovementLines
	}
	return tradedID, tradedSum, quoteSum, quoteCurrencyID, nil
}

// transferenciaPrincipalLegLines devuelve la primera OUT y la primera IN **posterior** a esa OUT
// (orden típico: pata salida, pata entrada, comisión), para no mezclar fee en el agregado FX.
func transferenciaPrincipalLegLines(lines []repositories.MovementLineRow) ([]repositories.MovementLineRow, bool) {
	outIx, inIx := -1, -1
	for i := range lines {
		if lines[i].Side == "OUT" && outIx < 0 {
			outIx = i
			continue
		}
		if lines[i].Side == "IN" && outIx >= 0 && inIx < 0 {
			inIx = i
			break
		}
	}
	if outIx < 0 || inIx < 0 {
		return nil, false
	}
	return []repositories.MovementLineRow{lines[outIx], lines[inIx]}, true
}

func ratTrimForFX(r *big.Rat) string {
	if r == nil {
		return "0"
	}
	return strings.TrimRight(strings.TrimRight(r.FloatString(12), "0"), ".")
}
