package http

import (
	"encoding/csv"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"fina/internal/repositories"
	"fina/internal/services"
)

func listCCBalancesHandler(svc *services.CCService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		items, err := svc.GetBalances(r.Context())
		if err != nil {
			RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Error al obtener posiciones.")
			return
		}
		if items == nil {
			items = []repositories.CCBalanceSummary{}
		}
		RespondJSON(w, http.StatusOK, items)
	}
}

func getClientCCBalancesHandler(svc *services.CCService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clientID := r.PathValue("client_id")
		if clientID == "" {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "client_id requerido")
			return
		}

		items, err := svc.GetClientBalances(r.Context(), clientID)
		if err != nil {
			RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Error al obtener balances del cliente.")
			return
		}
		if items == nil {
			items = []repositories.CCCurrencyBalance{}
		}
		RespondJSON(w, http.StatusOK, items)
	}
}

func listCCEntriesHandler(svc *services.CCService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clientID := r.URL.Query().Get("client_id")
		currencyID := r.URL.Query().Get("currency_id")

		if clientID == "" || currencyID == "" {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "client_id y currency_id son requeridos")
			return
		}

		items, err := svc.GetEntries(r.Context(), clientID, currencyID)
		if err != nil {
			RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Error al obtener movimientos CC.")
			return
		}
		if items == nil {
			items = []repositories.CCEntryItem{}
		}
		RespondJSON(w, http.StatusOK, items)
	}
}

const ccExportMaxRangeDays = 732

// exportCCEntriesCSVHandler genera CSV con lista blanca de columnas (solo filas cc_entries del cliente).
// Query: client_id, from, to (YYYY-MM-DD). Filtro por movements.date.
func exportCCEntriesCSVHandler(svc *services.CCService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clientID := r.URL.Query().Get("client_id")
		fromStr := r.URL.Query().Get("from")
		toStr := r.URL.Query().Get("to")
		if clientID == "" || fromStr == "" || toStr == "" {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "Parámetros requeridos: client_id, from, to (YYYY-MM-DD).")
			return
		}
		fromDate, err := time.ParseInLocation("2006-01-02", fromStr, time.UTC)
		if err != nil {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "from inválido; usar YYYY-MM-DD.")
			return
		}
		toDate, err := time.ParseInLocation("2006-01-02", toStr, time.UTC)
		if err != nil {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "to inválido; usar YYYY-MM-DD.")
			return
		}
		if toDate.Before(fromDate) {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "to debe ser >= from.")
			return
		}
		inclusiveDays := int(toDate.Sub(fromDate).Hours()/24) + 1
		if inclusiveDays > ccExportMaxRangeDays {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", fmt.Sprintf("Rango máximo %d días (inclusive).", ccExportMaxRangeDays))
			return
		}

		code, err := svc.GetClientCodeForExport(r.Context(), clientID)
		if err != nil {
			if errors.Is(err, repositories.ErrNotFound) {
				RespondError(w, http.StatusNotFound, "NOT_FOUND", "Cliente no encontrado.")
				return
			}
			RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Error al validar cliente.")
			return
		}

		rows, err := svc.ListEntriesForExport(r.Context(), clientID, fromDate, toDate)
		if err != nil {
			RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Error al generar export.")
			return
		}
		if rows == nil {
			rows = []repositories.CCEntryExportRow{}
		}

		filename := fmt.Sprintf("cc_%d_%s_%s.csv", code, fromStr, toStr)
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))

		if _, err := w.Write([]byte{0xEF, 0xBB, 0xBF}); err != nil {
			return
		}
		cw := csv.NewWriter(w)
		_ = cw.Write([]string{"fecha_asiento_cc", "fecha_operacion", "tipo_operacion", "numero_operacion", "divisa", "monto_cc", "nota"})
		for _, row := range rows {
			opNum := ""
			if row.OperationNumber != nil {
				opNum = strconv.FormatInt(*row.OperationNumber, 10)
			}
			_ = cw.Write([]string{
				row.CreatedAt.UTC().Format(time.RFC3339),
				row.MovementDate.Format("2006-01-02"),
				row.MovementType,
				opNum,
				row.CurrencyCode,
				row.Amount,
				row.Note,
			})
		}
		cw.Flush()
	}
}
