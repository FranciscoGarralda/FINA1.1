package http

import (
	"encoding/json"
	"errors"
	"net/http"

	"fina/internal/auth"
	"fina/internal/services"
)

func transferenciaHandler(svc *services.TransferenciaService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 65536)

		movementID := r.PathValue("id")
		if movementID == "" {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "id requerido")
			return
		}

		var input services.TransferenciaInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "Datos inválidos.")
			return
		}

		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
		err := svc.Execute(r.Context(), movementID, input, claims.UserID)
		if err != nil {
			mapTransferenciaError(w, err)
			return
		}

		RespondJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}
}

func mapTransferenciaError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, services.ErrTransfClientRequired):
		RespondError(w, http.StatusBadRequest, "CLIENT_REQUIRED",
			"La transferencia requiere un cliente.")
	case errors.Is(err, services.ErrDeliveryAmountInvalid):
		RespondError(w, http.StatusBadRequest, "DELIVERY_AMOUNT_INVALID",
			"El monto principal debe ser distinto de 0.")
	case errors.Is(err, services.ErrDeliveryNetInvalid):
		RespondError(w, http.StatusBadRequest, "DELIVERY_NET_INVALID",
			"Con comisión incluida, el monto neto a enviar debe ser mayor a 0.")
	case errors.Is(err, services.ErrCollectionsRequired):
		RespondError(w, http.StatusBadRequest, "COLLECTIONS_REQUIRED",
			"Debés cargar al menos un cobro.")
	case errors.Is(err, services.ErrCollectionAmtInvalid):
		RespondError(w, http.StatusBadRequest, "COLLECTION_AMOUNT_INVALID",
			"Los montos de cobro deben ser mayores a 0.")
	case errors.Is(err, services.ErrFeeValueInvalid):
		RespondError(w, http.StatusBadRequest, "FEE_VALUE_INVALID",
			"La comisión debe ser 0 o mayor.")
	case errors.Is(err, services.ErrInvalidFeePayer):
		RespondError(w, http.StatusBadRequest, "INVALID_FEE_PAYER",
			"Pagador de comisión inválido.")
	case errors.Is(err, services.ErrInvalidFeeTreatment):
		RespondError(w, http.StatusBadRequest, "INVALID_FEE_TREATMENT",
			"Tratamiento de comisión inválido.")
	case errors.Is(err, services.ErrInvalidFeeSettlement):
		RespondError(w, http.StatusBadRequest, "INVALID_FEE_SETTLEMENT",
			"Liquidación de comisión inválida.")
	case errors.Is(err, services.ErrFeeIncludedPendingNotAllowed):
		RespondError(w, http.StatusBadRequest, "FEE_INCLUDED_PENDING_NOT_ALLOWED",
			"Con comisión incluida no se permite comisión pendiente.")
	case errors.Is(err, services.ErrFeeCurrencyRequired):
		RespondError(w, http.StatusBadRequest, "FEE_CURRENCY_REQUIRED",
			"La divisa de comisión es obligatoria.")
	case errors.Is(err, services.ErrFeeAccountRequired):
		RespondError(w, http.StatusBadRequest, "FEE_ACCOUNT_REQUIRED",
			"La cuenta de comisión es obligatoria.")
	case errors.Is(err, services.ErrFeeFormatRequired):
		RespondError(w, http.StatusBadRequest, "FEE_FORMAT_REQUIRED",
			"El formato de comisión es obligatorio.")
	case errors.Is(err, services.ErrInvalidLegSettlement):
		RespondError(w, http.StatusBadRequest, "INVALID_LEG_SETTLEMENT",
			"La liquidación de pata debe ser REAL o PENDIENTE.")
	case errors.Is(err, services.ErrLegAmountInvalid):
		RespondError(w, http.StatusBadRequest, "LEG_AMOUNT_INVALID",
			"Las patas deben tener cuenta, divisa, formato y monto mayor a 0.")
	case errors.Is(err, services.ErrLegsCannotBeEqual):
		RespondError(w, http.StatusBadRequest, "LEGS_CANNOT_BE_EQUAL",
			"La pata de salida y entrada no pueden ser iguales.")
	case errors.Is(err, services.ErrFeePercentBaseInvalid):
		RespondError(w, http.StatusBadRequest, "FEE_PERCENT_BASE_INVALID",
			"Para comisión porcentual, la divisa de comisión debe coincidir con la divisa de una de las patas.")
	case errors.Is(err, services.ErrTotalDueMismatch):
		RespondError(w, http.StatusBadRequest, "TOTAL_DUE_MISMATCH",
			"El total a cobrar debe coincidir con el total adeudado (principal + comisión).")
	case errors.Is(err, services.ErrMixedCurrencyNotSupp):
		RespondError(w, http.StatusBadRequest, "MIXED_CURRENCY_NOT_SUPPORTED",
			"No se permite cobrar en distintas divisas en Transferencia.")
	case errors.Is(err, services.ErrInvalidSettlement):
		RespondError(w, http.StatusBadRequest, "INVALID_SETTLEMENT",
			"Tipo de liquidación inválido.")
	case errors.Is(err, services.ErrCCSettlementNotAllowed):
		RespondError(w, http.StatusBadRequest, "CC_SETTLEMENT_NOT_ALLOWED",
			"OWED_CC no está permitido en Transferencia; usar REAL u OWED_PENDING.")
	case errors.Is(err, services.ErrMovementNotFound):
		RespondError(w, http.StatusNotFound, "NOT_FOUND",
			"Movimiento no encontrado.")
	case errors.Is(err, services.ErrMovementTypeMismatch):
		RespondError(w, http.StatusBadRequest, "TYPE_MISMATCH",
			"El movimiento no es de tipo TRANSFERENCIA.")
	case errors.Is(err, services.ErrCCNotEnabledForClient):
		RespondError(w, http.StatusBadRequest, "CC_NOT_ENABLED_FOR_CLIENT",
			"El cliente no tiene cuenta corriente habilitada; no puede aplicarse impacto CC.")
	default:
		handleOperationError(w, err)
	}
}
