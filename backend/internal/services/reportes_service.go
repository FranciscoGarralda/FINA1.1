package services

import (
	"context"
	"math/big"
	"time"

	"fina/internal/repositories"

	"github.com/jackc/pgx/v5/pgxpool"
)

type ReportesService struct {
	pool        *pgxpool.Pool
	fxQuoteRepo *repositories.FXQuoteRepo
}

func NewReportesService(pool *pgxpool.Pool, fxQuoteRepo *repositories.FXQuoteRepo) *ReportesService {
	return &ReportesService{pool: pool, fxQuoteRepo: fxQuoteRepo}
}

type CurrencyAmount struct {
	CurrencyID   string `json:"currency_id"`
	CurrencyCode string `json:"currency_code"`
	Amount       string `json:"amount"`
}

type UsedQuote struct {
	FromCurrencyCode string    `json:"from_currency_code"`
	ToCurrencyCode   string    `json:"to_currency_code"`
	Rate             string    `json:"rate"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type MissingQuote struct {
	CurrencyCode string `json:"currency_code"`
	Reason       string `json:"reason"`
}

type ReportEstimated struct {
	BaseCurrencyCode string         `json:"base_currency_code"`
	Total            string         `json:"total"`
	Label            string         `json:"label"`
	UsedQuotes       []UsedQuote    `json:"used_quotes"`
	MissingQuotes    []MissingQuote `json:"missing_quotes"`
}

type ReportSection struct {
	ByCurrency []CurrencyAmount `json:"by_currency"`
}

type ReportResponse struct {
	Utilidad  ReportSection    `json:"utilidad"`
	Profit    ReportSection    `json:"profit"`
	Gastos    ReportSection    `json:"gastos"`
	Resultado ReportSection    `json:"resultado"`
	Estimated *ReportEstimated `json:"estimated,omitempty"`
}

func (s *ReportesService) Generate(ctx context.Context, from, to string, baseCurrencyID string) (*ReportResponse, error) {
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

	resp := &ReportResponse{
		Utilidad:  ReportSection{ByCurrency: mapToSlice(utilidad)},
		Profit:    ReportSection{ByCurrency: mapToSlice(profit)},
		Gastos:    ReportSection{ByCurrency: mapToSlice(gastos)},
		Resultado: ReportSection{ByCurrency: mapToSlice(resultado)},
	}

	if baseCurrencyID != "" {
		est, err := s.computeEstimated(ctx, resultado, baseCurrencyID)
		if err == nil {
			resp.Estimated = est
		}
	}

	return resp, nil
}

type currencyInfo struct {
	id   string
	code string
}

// computeFXUtility uses sequential moving weighted average for COMPRA/VENTA.
func (s *ReportesService) computeFXUtility(ctx context.Context, from, to string) (map[string]*big.Rat, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT m.id::text, m.type, ml.side, ml.currency_id::text, c.code, ml.amount::text
		 FROM movements m
		 JOIN movement_lines ml ON ml.movement_id = m.id
		 JOIN currencies c ON c.id = ml.currency_id
		 WHERE m.type IN ('COMPRA','VENTA')
		   AND m.date >= $1::date AND m.date <= $2::date
		 ORDER BY m.date ASC, m.operation_number ASC, ml.side ASC`, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type movLine struct {
		movID      string
		movType    string
		side       string
		currencyID string
		currCode   string
		amount     *big.Rat
	}

	var lines []movLine
	for rows.Next() {
		var ml movLine
		var amtStr string
		if err := rows.Scan(&ml.movID, &ml.movType, &ml.side, &ml.currencyID, &ml.currCode, &amtStr); err != nil {
			return nil, err
		}
		ml.amount, _ = new(big.Rat).SetString(amtStr)
		lines = append(lines, ml)
	}

	// Group lines by movement
	type movGroup struct {
		movType string
		lines   []movLine
	}
	movOrder := []string{}
	movMap := map[string]*movGroup{}
	for _, l := range lines {
		if _, ok := movMap[l.movID]; !ok {
			movOrder = append(movOrder, l.movID)
			movMap[l.movID] = &movGroup{movType: l.movType}
		}
		movMap[l.movID].lines = append(movMap[l.movID].lines, l)
	}

	// Per-currency accumulators for moving weighted average
	// Key: traded currency ID (the one being bought/sold, NOT the quote currency)
	type accumulator struct {
		code      string
		unitsIn   *big.Rat // total units bought
		costTotal *big.Rat // total cost in quote currency
		unitsOut  *big.Rat // total units sold
		revenue   *big.Rat // total revenue in quote currency
	}

	accum := map[string]*accumulator{}
	getAccum := func(currID, code string) *accumulator {
		if a, ok := accum[currID]; ok {
			return a
		}
		a := &accumulator{
			code:      code,
			unitsIn:   new(big.Rat),
			costTotal: new(big.Rat),
			unitsOut:  new(big.Rat),
			revenue:   new(big.Rat),
		}
		accum[currID] = a
		return a
	}

	// Utility is accumulated in the quote currency of each movement.
	// We need to know which currency is the "traded" one (IN for COMPRA, OUT for VENTA)
	// and which is the "quote" one (OUT for COMPRA, IN for VENTA).
	// The utility result is per QUOTE currency.

	// Actually, re-reading the spec:
	// "Utility must be accumulated in QUOTE currency (no FX conversion)."
	// result_real[currency] = profit[currency] - expenses[currency] + fx_utility[currency]
	// So fx_utility is keyed by QUOTE currency.

	// For COMPRA: IN side = traded currency, OUT side(s) = quote currency
	//   units_in (traded) += IN.amount
	//   cost_total (quote) += SUM(OUT.amount)
	// For VENTA: OUT side = traded currency, IN side(s) = quote currency
	//   units_out (traded) += OUT.amount
	//   revenue_total (quote) += SUM(IN.amount)
	// avg_cost = cost_total / units_in (per traded currency)
	// realized_cost = units_out * avg_cost
	// utility[quote_currency] = revenue - realized_cost

	// The challenge: utility is in quote currency, but avg_cost is per traded currency.
	// Since COMPRA and VENTA for the same traded currency should use the same quote currency
	// (in practice, e.g., buy USD with ARS, sell USD for ARS), the utility lands in ARS.

	// We need to track per TRADED currency: units, cost, revenue (all in the respective quote currency).
	// Then compute utility per traded currency, and the result currency is the quote currency.

	// Track quote currency per traded currency (assume consistent within the period)
	quoteCurrMap := map[string]currencyInfo{}

	for _, movID := range movOrder {
		mg := movMap[movID]
		if mg.movType == "COMPRA" {
			// IN lines = traded currency (should be one)
			// OUT lines = quote currency
			var tradedCurrID, tradedCode string
			var tradedAmount *big.Rat
			quoteTotal := new(big.Rat)
			var quoteCurrID, quoteCode string

			for _, l := range mg.lines {
				if l.side == "IN" {
					tradedCurrID = l.currencyID
					tradedCode = l.currCode
					tradedAmount = l.amount
				} else {
					quoteCurrID = l.currencyID
					quoteCode = l.currCode
					quoteTotal.Add(quoteTotal, l.amount)
				}
			}
			if tradedAmount == nil || tradedCurrID == "" {
				continue
			}

			a := getAccum(tradedCurrID, tradedCode)
			a.unitsIn.Add(a.unitsIn, tradedAmount)
			a.costTotal.Add(a.costTotal, quoteTotal)
			if quoteCurrID != "" {
				quoteCurrMap[tradedCurrID] = currencyInfo{id: quoteCurrID, code: quoteCode}
			}

		} else if mg.movType == "VENTA" {
			// OUT line = traded currency (should be one)
			// IN lines = quote currency
			var tradedCurrID, tradedCode string
			var tradedAmount *big.Rat
			quoteTotal := new(big.Rat)
			var quoteCurrID, quoteCode string

			for _, l := range mg.lines {
				if l.side == "OUT" {
					tradedCurrID = l.currencyID
					tradedCode = l.currCode
					tradedAmount = l.amount
				} else {
					quoteCurrID = l.currencyID
					quoteCode = l.currCode
					quoteTotal.Add(quoteTotal, l.amount)
				}
			}
			if tradedAmount == nil || tradedCurrID == "" {
				continue
			}

			a := getAccum(tradedCurrID, tradedCode)
			a.unitsOut.Add(a.unitsOut, tradedAmount)
			a.revenue.Add(a.revenue, quoteTotal)
			if quoteCurrID != "" {
				quoteCurrMap[tradedCurrID] = currencyInfo{id: quoteCurrID, code: quoteCode}
			}
		}
	}

	// Compute utility per traded currency → result in quote currency
	result := map[string]*big.Rat{}
	for tradedCurrID, a := range accum {
		qi, ok := quoteCurrMap[tradedCurrID]
		if !ok {
			continue
		}

		utility := new(big.Rat)
		if a.unitsIn.Sign() > 0 && a.unitsOut.Sign() > 0 {
			avgCost := new(big.Rat).Quo(a.costTotal, a.unitsIn)
			realizedCost := new(big.Rat).Mul(a.unitsOut, avgCost)
			utility.Sub(a.revenue, realizedCost)
		} else if a.unitsOut.Sign() == 0 {
			// No sales → no realized utility
		} else {
			// Units out but no units in (shouldn't happen but handle gracefully)
			utility.Set(a.revenue)
		}

		if existing, ok := result[qi.id]; ok {
			existing.Add(existing, utility)
		} else {
			result[qi.id] = utility
		}
	}

	return result, nil
}

func (s *ReportesService) computeProfit(ctx context.Context, from, to string) (map[string]*big.Rat, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT pe.currency_id::text, c.code, SUM(pe.amount)::text
		 FROM profit_entries pe
		 JOIN movements m ON m.id = pe.movement_id
		 JOIN currencies c ON c.id = pe.currency_id
		 WHERE m.date >= $1::date AND m.date <= $2::date
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
		amt, _ := new(big.Rat).SetString(amtStr)
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
		amt, _ := new(big.Rat).SetString(amtStr)
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

func (s *ReportesService) computeEstimated(ctx context.Context, resultado map[string]*big.Rat, baseCurrencyID string) (*ReportEstimated, error) {
	var baseCurrencyCode string
	err := s.pool.QueryRow(ctx, `SELECT code FROM currencies WHERE id=$1`, baseCurrencyID).Scan(&baseCurrencyCode)
	if err != nil {
		return nil, err
	}

	activeQuotes, err := s.fxQuoteRepo.ListActiveMap(ctx)
	if err != nil {
		return nil, err
	}

	total := new(big.Rat)
	var used []UsedQuote
	var missing []MissingQuote

	for currID, amt := range resultado {
		if currID == baseCurrencyID {
			total.Add(total, amt)

			var code string
			s.pool.QueryRow(ctx, `SELECT code FROM currencies WHERE id=$1`, currID).Scan(&code)
			used = append(used, UsedQuote{
				FromCurrencyCode: code,
				ToCurrencyCode:   baseCurrencyCode,
				Rate:             "1",
				UpdatedAt:        time.Now(),
			})
			continue
		}

		q, ok := activeQuotes[currID]
		if !ok {
			var code string
			s.pool.QueryRow(ctx, `SELECT code FROM currencies WHERE id=$1`, currID).Scan(&code)
			missing = append(missing, MissingQuote{
				CurrencyCode: code,
				Reason:       "Sin cotización manual activa hacia " + baseCurrencyCode,
			})
			continue
		}

		if q.ToCurrencyID != baseCurrencyID {
			var code string
			s.pool.QueryRow(ctx, `SELECT code FROM currencies WHERE id=$1`, currID).Scan(&code)
			missing = append(missing, MissingQuote{
				CurrencyCode: code,
				Reason:       "Cotización activa no apunta a " + baseCurrencyCode,
			})
			continue
		}

		rate, _ := new(big.Rat).SetString(q.Rate)
		converted := new(big.Rat).Mul(amt, rate)
		total.Add(total, converted)
		used = append(used, UsedQuote{
			FromCurrencyCode: q.FromCurrencyCode,
			ToCurrencyCode:   q.ToCurrencyCode,
			Rate:             q.Rate,
			UpdatedAt:        q.UpdatedAt,
		})
	}

	return &ReportEstimated{
		BaseCurrencyCode: baseCurrencyCode,
		Total:            total.FloatString(2),
		Label:            "ESTIMADO con cotización manual (no contable)",
		UsedQuotes:       used,
		MissingQuotes:    missing,
	}, nil
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

func (s *ReportesService) GenerateWithCodes(ctx context.Context, from, to, baseCurrencyID string) (*ReportResponse, error) {
	resp, err := s.Generate(ctx, from, to, baseCurrencyID)
	if err != nil {
		return nil, err
	}

	codeMap, _ := s.loadCurrencyCodes(ctx)
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
		rows.Scan(&id, &code)
		m[id] = code
	}
	return m, nil
}

func enrichCodes(items []CurrencyAmount, codeMap map[string]string) {
	for i := range items {
		if code, ok := codeMap[items[i].CurrencyID]; ok {
			items[i].CurrencyCode = code
		}
	}
}
