package services

import (
	"context"
	"fmt"
	"math/big"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type ReportesService struct {
	pool *pgxpool.Pool
}

func NewReportesService(pool *pgxpool.Pool) *ReportesService {
	return &ReportesService{pool: pool}
}

type CurrencyAmount struct {
	CurrencyID   string `json:"currency_id"`
	CurrencyCode string `json:"currency_code"`
	Amount       string `json:"amount"`
}

type ReportSection struct {
	ByCurrency []CurrencyAmount `json:"by_currency"`
}

type ReportResponse struct {
	Utilidad  ReportSection `json:"utilidad"`
	Profit    ReportSection `json:"profit"`
	Gastos    ReportSection `json:"gastos"`
	Resultado ReportSection `json:"resultado"`
}

func (s *ReportesService) Generate(ctx context.Context, from, to string) (*ReportResponse, error) {
	utilidad, err := s.computeFXUtility(ctx, from, to)
	if err != nil {
		return nil, err
	}

	profit, err := s.computeProfit(ctx, from, to)
	if err != nil {
		return nil, err
	}

	gastos, err := s.computeGastos(ctx, from, to)
	if err != nil {
		return nil, err
	}

	resultado := s.computeResultado(utilidad, profit, gastos)

	return &ReportResponse{
		Utilidad:  ReportSection{ByCurrency: mapToSlice(utilidad)},
		Profit:    ReportSection{ByCurrency: mapToSlice(profit)},
		Gastos:    ReportSection{ByCurrency: mapToSlice(gastos)},
		Resultado: ReportSection{ByCurrency: mapToSlice(resultado)},
	}, nil
}

// computeFXUtility suma utilidad realizada de inventario FX (solo COMPRA/VENTA) desde fx_inventory_ledger.
// Incluye APPLY y REVERSE por fecha de operación del movimiento (anulaciones en el período netean).
func (s *ReportesService) computeFXUtility(ctx context.Context, from, to string) (map[string]*big.Rat, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT l.functional_currency_id::text, COALESCE(SUM(l.realized_pnl_functional), 0)::text
		 FROM fx_inventory_ledger l
		 INNER JOIN movements m ON m.id = l.movement_id
		 WHERE m.type IN ('COMPRA','VENTA')
		   AND m.date >= $1::date AND m.date <= $2::date
		 GROUP BY l.functional_currency_id`, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := map[string]*big.Rat{}
	for rows.Next() {
		var currID, amtStr string
		if err := rows.Scan(&currID, &amtStr); err != nil {
			return nil, err
		}
		amt, err := parseAggRat(amtStr, "utilidad_fx")
		if err != nil {
			return nil, err
		}
		result[currID] = amt
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

// parseAggRat valida SUM(...)::text para agregados de reportes (profit / gastos).
func parseAggRat(amtStr, label string) (*big.Rat, error) {
	amt, ok := new(big.Rat).SetString(amtStr)
	if !ok {
		return nil, fmt.Errorf("monto inválido en agregado de reportes (%s)", label)
	}
	return amt, nil
}

func (s *ReportesService) computeProfit(ctx context.Context, from, to string) (map[string]*big.Rat, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT pe.currency_id::text, c.code, SUM(pe.amount)::text
		 FROM profit_entries pe
		 JOIN movements m ON m.id = pe.movement_id
		 JOIN currencies c ON c.id = pe.currency_id
		 WHERE m.status = 'CONFIRMADA'
		   AND m.date >= $1::date AND m.date <= $2::date
		 GROUP BY pe.currency_id, c.code`, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := map[string]*big.Rat{}
	for rows.Next() {
		var currID, code, amtStr string
		if err := rows.Scan(&currID, &code, &amtStr); err != nil {
			return nil, err
		}
		amt, err := parseAggRat(amtStr, "profit")
		if err != nil {
			return nil, err
		}
		result[currID] = amt
		_ = code
	}
	return result, nil
}

func (s *ReportesService) computeGastos(ctx context.Context, from, to string) (map[string]*big.Rat, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT ml.currency_id::text, c.code, SUM(ml.amount)::text
		 FROM movement_lines ml
		 JOIN movements m ON m.id = ml.movement_id
		 JOIN currencies c ON c.id = ml.currency_id
		 WHERE m.type = 'GASTO' AND ml.side = 'OUT'
		   AND m.status = 'CONFIRMADA'
		   AND m.date >= $1::date AND m.date <= $2::date
		 GROUP BY ml.currency_id, c.code`, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := map[string]*big.Rat{}
	for rows.Next() {
		var currID, code, amtStr string
		if err := rows.Scan(&currID, &code, &amtStr); err != nil {
			return nil, err
		}
		amt, err := parseAggRat(amtStr, "gastos")
		if err != nil {
			return nil, err
		}
		result[currID] = amt
		_ = code
	}
	return result, nil
}

func (s *ReportesService) computeResultado(utilidad, profit, gastos map[string]*big.Rat) map[string]*big.Rat {
	allCurrencies := map[string]bool{}
	for k := range utilidad {
		allCurrencies[k] = true
	}
	for k := range profit {
		allCurrencies[k] = true
	}
	for k := range gastos {
		allCurrencies[k] = true
	}

	result := map[string]*big.Rat{}
	for currID := range allCurrencies {
		r := new(big.Rat)
		if u, ok := utilidad[currID]; ok {
			r.Add(r, u)
		}
		if p, ok := profit[currID]; ok {
			r.Add(r, p)
		}
		if g, ok := gastos[currID]; ok {
			r.Sub(r, g)
		}
		result[currID] = r
	}
	return result
}

func mapToSlice(m map[string]*big.Rat) []CurrencyAmount {
	if len(m) == 0 {
		return []CurrencyAmount{}
	}

	// We need currency codes — we'll use a separate lookup approach
	// Since we already have the data, we need to enrich with codes
	items := make([]CurrencyAmount, 0, len(m))
	for currID, amt := range m {
		items = append(items, CurrencyAmount{
			CurrencyID: currID,
			Amount:     amt.FloatString(2),
		})
	}
	return items
}

func (s *ReportesService) GenerateWithCodes(ctx context.Context, from, to string) (*ReportResponse, error) {
	resp, err := s.Generate(ctx, from, to)
	if err != nil {
		return nil, err
	}

	codeMap, err := s.loadCurrencyCodes(ctx)
	if err != nil {
		return nil, err
	}
	enrichCodes(resp.Utilidad.ByCurrency, codeMap)
	enrichCodes(resp.Profit.ByCurrency, codeMap)
	enrichCodes(resp.Gastos.ByCurrency, codeMap)
	enrichCodes(resp.Resultado.ByCurrency, codeMap)

	return resp, nil
}

func (s *ReportesService) loadCurrencyCodes(ctx context.Context) (map[string]string, error) {
	rows, err := s.pool.Query(ctx, `SELECT id::text, code FROM currencies`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	m := make(map[string]string)
	for rows.Next() {
		var id, code string
		if err := rows.Scan(&id, &code); err != nil {
			return nil, err
		}
		m[id] = code
	}
	return m, rows.Err()
}

func enrichCodes(items []CurrencyAmount, codeMap map[string]string) {
	for i := range items {
		if code, ok := codeMap[items[i].CurrencyID]; ok {
			items[i].CurrencyCode = code
		}
	}
}

// DashboardDayMetrics cuatro secciones de un reporte de un solo día (sin estimated).
type DashboardDayMetrics struct {
	Utilidad  ReportSection `json:"utilidad"`
	Profit    ReportSection `json:"profit"`
	Gastos    ReportSection `json:"gastos"`
	Resultado ReportSection `json:"resultado"`
}

// DashboardDailySummaryResponse compara el día de referencia con el día calendario anterior.
// Misma lógica que GenerateWithCodes (módulo Reportes).
type DashboardDailySummaryResponse struct {
	ReferenceDate string              `json:"reference_date"`
	CompareDate   string              `json:"compare_date"`
	Reference     DashboardDayMetrics `json:"reference"`
	Compare       DashboardDayMetrics `json:"compare"`
	Definitions   map[string]string   `json:"definitions"`
}

func reportResponseToDayMetrics(r *ReportResponse) DashboardDayMetrics {
	return DashboardDayMetrics{
		Utilidad:  r.Utilidad,
		Profit:    r.Profit,
		Gastos:    r.Gastos,
		Resultado: r.Resultado,
	}
}

// DailySummary genera dos reportes de un día cada uno: referenceDate y referenceDate−1 (calendario).
// referenceDate debe ser YYYY-MM-DD.
func (s *ReportesService) DailySummary(ctx context.Context, referenceDate string) (*DashboardDailySummaryResponse, error) {
	t, err := time.Parse("2006-01-02", referenceDate)
	if err != nil {
		return nil, fmt.Errorf("invalid reference date: %w", err)
	}
	dayStr := t.Format("2006-01-02")
	prevStr := t.AddDate(0, 0, -1).Format("2006-01-02")

	refRep, err := s.GenerateWithCodes(ctx, dayStr, dayStr)
	if err != nil {
		return nil, err
	}
	cmpRep, err := s.GenerateWithCodes(ctx, prevStr, prevStr)
	if err != nil {
		return nil, err
	}

	defs := map[string]string{
		"utilidad":  "Utilidad compra-venta: P&L realizado con inventario y costo promedio (moneda funcional, p. ej. ARS). Fuente: fx_inventory_ledger + fx_positions. Sin arbitraje ni profit_entries.",
		"profit":    "Suma de profit_entries del día por divisa (solo movimientos CONFIRMADA). Backend: reportes_service.computeProfit.",
		"gastos":    "Suma de líneas OUT en movimientos tipo GASTO (solo CONFIRMADA; CANCELADA no cuenta). Backend: reportes_service.computeGastos.",
		"resultado": "Por divisa: utilidad + profit − gastos. Backend: reportes_service.computeResultado.",
	}

	return &DashboardDailySummaryResponse{
		ReferenceDate: dayStr,
		CompareDate:   prevStr,
		Reference:     reportResponseToDayMetrics(refRep),
		Compare:       reportResponseToDayMetrics(cmpRep),
		Definitions:   defs,
	}, nil
}
