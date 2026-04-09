package http

import (
	"encoding/json"
	"errors"
	"net/http"

	"fina/internal/auth"
	"fina/internal/repositories"
	"fina/internal/services"
)

func createMovementHandler(svc *services.OperationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 4096)

		var input services.CreateMovementInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "Datos inválidos.")
			return
		}

		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
		result, err := svc.CreateMovement(r.Context(), input, claims.UserID)
		if err != nil {
			handleOperationError(w, err)
			return
		}

		RespondJSON(w, http.StatusCreated, result)
	}
}

func patchMovementHeaderHandler(svc *services.OperationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 8192)
		movementID := r.PathValue("id")
		if movementID == "" {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "id requerido")
			return
		}
		var input services.PatchMovementHeaderInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "Datos inválidos.")
			return
		}
		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
		result, err := svc.PatchMovementHeader(r.Context(), movementID, input, claims.UserID)
		if err != nil {
			handleOperationError(w, err)
			return
		}
		RespondJSON(w, http.StatusOK, result)
	}
}

func saveMovementDraftHandler(svc *services.OperationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 512*1024)
		movementID := r.PathValue("id")
		if movementID == "" {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "id requerido")
			return
		}

		var input services.SaveDraftInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "Datos inválidos.")
			return
		}

		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
		if err := svc.SaveMovementDraft(r.Context(), movementID, input, claims.UserID); err != nil {
			handleOperationError(w, err)
			return
		}

		RespondJSON(w, http.StatusOK, map[string]string{"status": "draft_saved"})
	}
}

func getMovementDraftHandler(svc *services.OperationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		movementID := r.PathValue("id")
		if movementID == "" {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "id requerido")
			return
		}

		result, err := svc.GetMovementDraft(r.Context(), movementID)
		if err != nil {
			handleOperationError(w, err)
			return
		}
		RespondJSON(w, http.StatusOK, result)
	}
}

func discardMovementDraftHandler(svc *services.OperationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		movementID := r.PathValue("id")
		if movementID == "" {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "id requerido")
			return
		}

		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
		if err := svc.DiscardMovementDraft(r.Context(), movementID, claims.UserID); err != nil {
			handleOperationError(w, err)
			return
		}

		RespondJSON(w, http.StatusOK, map[string]bool{"discarded": true})
	}
}

func cancelMovementHandler(svc *services.OperationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		movementID := r.PathValue("id")
		if movementID == "" {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "id requerido")
			return
		}

		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
		if err := svc.CancelMovement(r.Context(), movementID, claims.UserID); err != nil {
			handleOperationError(w, err)
			return
		}

		RespondJSON(w, http.StatusOK, map[string]string{"status": "cancelled"})
	}
}

func startModifyMovementHandler(svc *services.OperationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		movementID := r.PathValue("id")
		if movementID == "" {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "id requerido")
			return
		}
		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
		result, err := svc.StartModifyFromConfirmed(r.Context(), movementID, claims.UserID)
		if err != nil {
			handleOperationError(w, err)
			return
		}
		RespondJSON(w, http.StatusCreated, result)
	}
}

func recreateFromCancelledHandler(svc *services.OperationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		movementID := r.PathValue("id")
		if movementID == "" {
			RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "id requerido")
			return
		}
		claims := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
		result, err := svc.StartRecreateFromCancelled(r.Context(), movementID, claims.UserID)
		if err != nil {
			handleOperationError(w, err)
			return
		}
		RespondJSON(w, http.StatusCreated, result)
	}
}

func handleOperationError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, services.ErrTypeDisabled):
		RespondError(w, http.StatusBadRequest, "TYPE_DISABLED", "TRANSFERENCIA está deshabilitada temporalmente. Usá las operaciones específicas.")
	case errors.Is(err, services.ErrInvalidMovementType):
		RespondError(w, http.StatusBadRequest, "INVALID_TYPE", "Tipo de operación inválido.")
	case errors.Is(err, services.ErrClientRequired):
		RespondError(w, http.StatusBadRequest, "CLIENT_REQUIRED", "El cliente es obligatorio para este tipo de operación.")
	case errors.Is(err, services.ErrDateRequired):
		RespondError(w, http.StatusBadRequest, "DATE_REQUIRED", "La fecha es obligatoria.")
	case errors.Is(err, services.ErrMovementIDRequired):
		RespondError(w, http.StatusBadRequest, "BAD_REQUEST", "id requerido")
	case errors.Is(err, services.ErrDraftPayloadInvalid):
		RespondError(w, http.StatusBadRequest, "DRAFT_PAYLOAD_INVALID", "Payload de borrador inválido.")
	case errors.Is(err, services.ErrPayloadClearConfirmationRequired):
		RespondError(w, http.StatusConflict, "PAYLOAD_CLEAR_CONFIRMATION_REQUIRED", "Hay datos guardados en el borrador. Confirmá para descartarlos y aplicar el cambio de tipo o cliente.")
	case errors.Is(err, services.ErrMovementNotDraft):
		RespondError(w, http.StatusBadRequest, "MOVEMENT_NOT_DRAFT", "El movimiento no está en estado BORRADOR.")
	case errors.Is(err, services.ErrMovementNotConfirmed):
		RespondError(w, http.StatusBadRequest, "MOVEMENT_NOT_CONFIRMED", "Solo se pueden anular movimientos en estado CONFIRMADA.")
	case errors.Is(err, services.ErrMovementNotModifiable):
		RespondError(w, http.StatusBadRequest, "MOVEMENT_NOT_MODIFIABLE", "Solo se puede modificar desde una operación CONFIRMADA.")
	case errors.Is(err, services.ErrMovementNotCancelled):
		RespondError(w, http.StatusBadRequest, "MOVEMENT_NOT_CANCELLED", "Solo se puede recrear desde una operación ANULADA.")
	case errors.Is(err, services.ErrMovementAlreadyCancelled):
		RespondError(w, http.StatusConflict, "ALREADY_CANCELLED", "El movimiento ya está cancelado.")
	case err != nil && err.Error() == "CANCEL_NET_REAL_NOT_ZERO":
		RespondError(w, http.StatusConflict, "CANCEL_NET_REAL_NOT_ZERO", "La anulación no pudo neutralizar el neto real.")
	case err != nil && err.Error() == "CANCEL_NET_CC_NOT_ZERO":
		RespondError(w, http.StatusConflict, "CANCEL_NET_CC_NOT_ZERO", "La anulación no pudo neutralizar el neto en cuenta corriente.")
	case errors.Is(err, repositories.ErrClientInactive):
		RespondError(w, http.StatusBadRequest, "CLIENT_INACTIVE", "El cliente está inactivo.")
	case errors.Is(err, repositories.ErrCurrencyNotEnabled):
		RespondError(w, http.StatusBadRequest, "CURRENCY_NOT_ENABLED", "La divisa no está habilitada para la cuenta.")
	case errors.Is(err, repositories.ErrFormatNotAllowed):
		RespondError(w, http.StatusBadRequest, "FORMAT_NOT_ALLOWED", "El formato no está permitido para esta cuenta/divisa.")
	case errors.Is(err, services.ErrHandlerNotReady):
		RespondError(w, http.StatusNotImplemented, "NOT_IMPLEMENTED", "Este tipo de operación aún no está implementado.")
	case errors.Is(err, repositories.ErrNotFound):
		RespondError(w, http.StatusNotFound, "NOT_FOUND", "Recurso no encontrado.")
	case errors.Is(err, services.ErrCCNotEnabledForClient):
		RespondError(w, http.StatusBadRequest, "CC_NOT_ENABLED_FOR_CLIENT",
			"El cliente no tiene cuenta corriente habilitada; no puede aplicarse impacto CC.")
	case errors.Is(err, services.ErrFXInsufficientInventory):
		RespondError(w, http.StatusConflict, "FX_INSUFFICIENT_INVENTORY",
			"No hay stock suficiente de la divisa vendida para registrar la venta con el inventario FX.")
	case errors.Is(err, services.ErrFXQuoteNotFunctional):
		RespondError(w, http.StatusBadRequest, "FX_QUOTE_CURRENCY_NOT_FUNCTIONAL",
			"La cotización debe estar en la moneda funcional del inventario FX (configuración fx_functional_currency_code).")
	case errors.Is(err, services.ErrFXFunctionalCurrencyUnset):
		RespondError(w, http.StatusInternalServerError, "FX_FUNCTIONAL_CURRENCY_UNSET",
			"Falta o es inválida la moneda funcional del inventario FX en configuración.")
	case errors.Is(err, services.ErrFXInvalidMovementLines):
		RespondError(w, http.StatusBadRequest, "FX_INVALID_MOVEMENT_LINES",
			"Las líneas del movimiento no permiten calcular inventario FX (COMPRA/VENTA).")
	default:
		RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Error interno del servidor.")
	}
}
