package http

import (
	"encoding/json"
	"net/http"

	"fina/internal/auth"
	"fina/internal/repositories"
	"fina/internal/services"

	"github.com/jackc/pgx/v5/pgxpool"
)

func NewRouter(pool *pgxpool.Pool, jwtSecret string) http.Handler {
	mux := http.NewServeMux()

	userRepo := repositories.NewUserRepo(pool)
	settingsRepo := repositories.NewSettingsRepo(pool)
	entityRepo := repositories.NewEntityRepo(pool)
	auditRepo := repositories.NewAuditRepo(pool)

	currencyRepo := repositories.NewCurrencyRepo(pool)
	accountRepo := repositories.NewAccountRepo(pool)
	clientRepo := repositories.NewClientRepo(pool)

	authSvc := services.NewAuthService(userRepo, jwtSecret)
	settingsSvc := services.NewSettingsService(settingsRepo, entityRepo, auditRepo)
	userSvc := services.NewUserService(userRepo, settingsRepo, auditRepo)
	currencySvc := services.NewCurrencyService(currencyRepo, auditRepo)
	accountSvc := services.NewAccountService(accountRepo, auditRepo)
	clientSvc := services.NewClientService(pool, clientRepo, auditRepo)
	ccRepo := repositories.NewCCRepo(pool)
	ccSvc := services.NewCCService(pool, ccRepo, auditRepo)
	pendingRepo := repositories.NewPendingRepo(pool)
	pendingSvc := services.NewPendingService(pool, pendingRepo, settingsRepo, auditRepo)
	movementRepo := repositories.NewMovementRepo(pool)
	movementSvc := services.NewMovementService(movementRepo)
	operationRepo := repositories.NewOperationRepo(pool)
	operationSvc := services.NewOperationService(pool, operationRepo, auditRepo)
	permissionsRepo := repositories.NewPermissionsRepo(pool)
	permissionsSvc := services.NewPermissionsService(permissionsRepo)
	userPermissionsRepo := repositories.NewUserPermissionsRepo(pool)
	userPermissionsSvc := services.NewUserPermissionsService(permissionsSvc, userRepo, userPermissionsRepo, auditRepo)
	compraSvc := services.NewCompraService(pool, operationRepo, ccSvc, auditRepo)
	ventaSvc := services.NewVentaService(pool, operationRepo, ccSvc, auditRepo)
	arbitrajeSvc := services.NewArbitrajeService(pool, operationRepo, ccSvc, auditRepo)
	tecSvc := services.NewTransferenciaEntreCuentasService(pool, operationRepo, auditRepo)
	ingresoCapitalSvc := services.NewIngresoCapitalService(pool, operationRepo, ccSvc, auditRepo)
	retiroCapitalSvc := services.NewRetiroCapitalService(pool, operationRepo, ccSvc, auditRepo)
	gastoSvc := services.NewGastoService(pool, operationRepo, auditRepo)
	pagoCCSvc := services.NewPagoCCCruzadoService(pool, operationRepo, ccSvc, auditRepo)
	transferenciaSvc := services.NewTransferenciaService(pool, operationRepo, ccSvc, auditRepo)
	traspasoDeudaCCSvc := services.NewTraspasoDeudaCCService(pool, operationRepo, ccSvc, auditRepo)
	fxQuoteRepo := repositories.NewFXQuoteRepo(pool)
	reportesSvc := services.NewReportesService(pool, fxQuoteRepo)
	cashPosRepo := repositories.NewCashPositionRepo(pool)
	cashPosSvc := services.NewCashPositionService(cashPosRepo)
	auditLogsRepo := repositories.NewAuditLogsRepo(pool)
	auditLogsSvc := services.NewAuditLogsService(auditLogsRepo)

	allRoles := []string{"SUPERADMIN", "ADMIN", "SUBADMIN", "OPERATOR", "COURIER"}
	dashboardRoles := allRoles
	viewRoles := []string{"SUPERADMIN", "ADMIN", "SUBADMIN"}
	editRoles := []string{"SUPERADMIN", "SUBADMIN"}
	superOnly := []string{"SUPERADMIN"}
	currencyViewRoles := []string{"SUPERADMIN", "ADMIN", "SUBADMIN", "OPERATOR"}
	currencyEditRoles := []string{"SUPERADMIN", "ADMIN", "SUBADMIN"}
	accountViewRoles := []string{"SUPERADMIN", "ADMIN", "SUBADMIN", "OPERATOR"}
	accountEditRoles := []string{"SUPERADMIN", "ADMIN", "SUBADMIN"}
	clientViewRoles := []string{"SUPERADMIN", "ADMIN", "SUBADMIN", "OPERATOR", "COURIER"}
	clientEditRoles := []string{"SUPERADMIN", "ADMIN", "SUBADMIN", "OPERATOR"}
	ccViewRoles := []string{"SUPERADMIN", "ADMIN", "SUBADMIN", "OPERATOR"}
	movementViewRoles := []string{"SUPERADMIN", "ADMIN", "SUBADMIN", "OPERATOR"}
	operationRoles := []string{"SUPERADMIN", "ADMIN", "SUBADMIN", "OPERATOR"}

	// Public
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})
	mux.HandleFunc("POST /api/login", loginHandler(authSvc))
	mux.HandleFunc("POST /api/login/pin", loginPINHandler(authSvc))

	// Settings
	mux.Handle("GET /api/settings", RequirePermission(jwtSecret, userPermissionsSvc, "settings.view", viewRoles, http.HandlerFunc(getSettingsHandler(settingsSvc))))
	mux.Handle("PUT /api/settings", RequirePermission(jwtSecret, userPermissionsSvc, "settings.edit", superOnly, http.HandlerFunc(putSettingsHandler(settingsSvc))))

	// Entity lists
	mux.Handle("GET /api/users", RequirePermission(jwtSecret, userPermissionsSvc, "users.view", viewRoles, http.HandlerFunc(listUsersHandler(settingsSvc, entityRepo))))
	mux.Handle("GET /api/accounts", RequirePermission(jwtSecret, userPermissionsSvc, "accounts.view", accountViewRoles, http.HandlerFunc(listAccountsHandler(entityRepo))))
	mux.Handle("GET /api/currencies", RequirePermission(jwtSecret, userPermissionsSvc, "currencies.view", currencyViewRoles, http.HandlerFunc(listCurrenciesHandler(entityRepo))))
	mux.Handle("GET /api/clients", RequirePermission(jwtSecret, userPermissionsSvc, "clients.view", clientViewRoles, http.HandlerFunc(listClientsHandler(entityRepo))))

	// Entity active toggles
	mux.Handle("PUT /api/users/{id}/active", RequirePermission(jwtSecret, userPermissionsSvc, "users.toggle_active", superOnly, http.HandlerFunc(toggleActiveHandler(settingsSvc, "users"))))
	mux.Handle("PUT /api/accounts/{id}/active", RequirePermission(jwtSecret, userPermissionsSvc, "accounts.toggle_active", accountEditRoles, http.HandlerFunc(toggleActiveHandler(settingsSvc, "accounts"))))
	mux.Handle("PUT /api/currencies/{id}/active", RequirePermission(jwtSecret, userPermissionsSvc, "currencies.toggle_active", currencyEditRoles, http.HandlerFunc(toggleActiveHandler(settingsSvc, "currencies"))))
	mux.Handle("PUT /api/clients/{id}/active", RequirePermission(jwtSecret, userPermissionsSvc, "clients.toggle_active", clientEditRoles, http.HandlerFunc(toggleActiveHandler(settingsSvc, "clients"))))

	// Accounts CRUD
	mux.Handle("POST /api/accounts", RequirePermission(jwtSecret, userPermissionsSvc, "accounts.create", accountEditRoles, http.HandlerFunc(createAccountHandler(accountSvc))))
	mux.Handle("PUT /api/accounts/{id}", RequirePermission(jwtSecret, userPermissionsSvc, "accounts.edit", accountEditRoles, http.HandlerFunc(updateAccountHandler(accountSvc))))
	mux.Handle("GET /api/accounts/{id}/currencies", RequirePermission(jwtSecret, userPermissionsSvc, "accounts.view", accountViewRoles, http.HandlerFunc(getAccountCurrenciesHandler(accountSvc))))
	mux.Handle("PUT /api/accounts/{id}/currencies", RequirePermission(jwtSecret, userPermissionsSvc, "accounts.currencies.edit", accountEditRoles, http.HandlerFunc(updateAccountCurrenciesHandler(accountSvc))))

	// Clients CRUD
	mux.Handle("GET /api/clients/{id}", RequirePermission(jwtSecret, userPermissionsSvc, "clients.view", clientViewRoles, http.HandlerFunc(getClientHandler(clientSvc))))
	mux.Handle("POST /api/clients", RequirePermission(jwtSecret, userPermissionsSvc, "clients.create", clientEditRoles, http.HandlerFunc(createClientHandler(clientSvc))))
	mux.Handle("PUT /api/clients/{id}", RequirePermission(jwtSecret, userPermissionsSvc, "clients.edit", clientEditRoles, http.HandlerFunc(updateClientHandler(clientSvc))))

	// Currencies CRUD
	mux.Handle("POST /api/currencies", RequirePermission(jwtSecret, userPermissionsSvc, "currencies.create", currencyEditRoles, http.HandlerFunc(createCurrencyHandler(currencySvc))))
	mux.Handle("PUT /api/currencies/{id}", RequirePermission(jwtSecret, userPermissionsSvc, "currencies.edit", currencyEditRoles, http.HandlerFunc(updateCurrencyHandler(currencySvc))))

	// Users CRUD
	mux.Handle("POST /api/users", RequirePermission(jwtSecret, userPermissionsSvc, "users.create", editRoles, http.HandlerFunc(createUserHandler(userSvc))))
	mux.Handle("PUT /api/users/{id}", RequirePermission(jwtSecret, userPermissionsSvc, "users.edit", editRoles, http.HandlerFunc(updateUserHandler(userSvc))))
	mux.Handle("PUT /api/users/{id}/reset-password", RequirePermission(jwtSecret, userPermissionsSvc, "users.reset_password", editRoles, http.HandlerFunc(resetPasswordHandler(userSvc))))
	mux.Handle("GET /api/users/{id}/permissions", RequirePermission(jwtSecret, userPermissionsSvc, "permissions.view_user", superOnly, http.HandlerFunc(getUserPermissionsHandler(userPermissionsSvc))))
	mux.Handle("PUT /api/users/{id}/permissions", RequirePermission(jwtSecret, userPermissionsSvc, "permissions.edit_user", superOnly, http.HandlerFunc(putUserPermissionsHandler(userPermissionsSvc))))
	mux.Handle("DELETE /api/users/{id}/permissions/overrides", RequirePermission(jwtSecret, userPermissionsSvc, "permissions.reset_user_to_default", superOnly, http.HandlerFunc(resetUserPermissionsHandler(userPermissionsSvc))))

	// Profile (self-service)
	mux.Handle("GET /api/auth/me", auth.RequireAuth(jwtSecret, allRoles, http.HandlerFunc(getMeHandler(userRepo, settingsRepo))))
	mux.Handle("GET /api/auth/me/permissions", RequirePermission(jwtSecret, userPermissionsSvc, "profile.view", allRoles, http.HandlerFunc(myPermissionsHandler(userPermissionsSvc))))
	mux.Handle("POST /api/users/me/change-password", auth.RequireAuth(jwtSecret, allRoles, http.HandlerFunc(changeOwnPasswordHandler(userSvc))))
	mux.Handle("POST /api/users/me/change-pin", auth.RequireAuth(jwtSecret, []string{"COURIER"}, http.HandlerFunc(changeOwnPinHandler(userSvc))))

	// CC / Posiciones
	mux.Handle("GET /api/cc-balances", RequirePermission(jwtSecret, userPermissionsSvc, "cc.view", ccViewRoles, http.HandlerFunc(listCCBalancesHandler(ccSvc))))
	mux.Handle("GET /api/cc-balances/{client_id}", RequirePermission(jwtSecret, userPermissionsSvc, "cc.view", ccViewRoles, http.HandlerFunc(getClientCCBalancesHandler(ccSvc))))
	mux.Handle("GET /api/cc-entries/export.csv", RequirePermission(jwtSecret, userPermissionsSvc, "cc.export_csv", ccViewRoles, http.HandlerFunc(exportCCEntriesCSVHandler(ccSvc))))
	mux.Handle("GET /api/cc-entries", RequirePermission(jwtSecret, userPermissionsSvc, "cc.view", ccViewRoles, http.HandlerFunc(listCCEntriesHandler(ccSvc))))

	// Movements
	mux.Handle("GET /api/movements/drafts", RequirePermission(jwtSecret, userPermissionsSvc, "movements.view", movementViewRoles, http.HandlerFunc(listMovementDraftsHandler(movementSvc))))
	mux.Handle("GET /api/movements", RequirePermission(jwtSecret, userPermissionsSvc, "movements.view", movementViewRoles, http.HandlerFunc(listMovementsHandler(movementSvc))))
	mux.Handle("GET /api/movements/{id}", RequirePermission(jwtSecret, userPermissionsSvc, "movements.detail.view", movementViewRoles, http.HandlerFunc(getMovementHandler(movementSvc))))

	// Operations (create movement header)
	mux.Handle("POST /api/movements", RequirePermission(jwtSecret, userPermissionsSvc, "operations.create_header", operationRoles, http.HandlerFunc(createMovementHandler(operationSvc))))
	mux.Handle("PATCH /api/movements/{id}/header", RequirePermission(jwtSecret, userPermissionsSvc, "operations.create_header", operationRoles, http.HandlerFunc(patchMovementHeaderHandler(operationSvc))))
	mux.Handle("PUT /api/movements/{id}/draft", RequirePermission(jwtSecret, userPermissionsSvc, "operations.create_header", operationRoles, http.HandlerFunc(saveMovementDraftHandler(operationSvc))))
	mux.Handle("GET /api/movements/{id}/draft", RequirePermission(jwtSecret, userPermissionsSvc, "operations.create_header", operationRoles, http.HandlerFunc(getMovementDraftHandler(operationSvc))))
	mux.Handle("DELETE /api/movements/{id}/discard-draft", RequirePermission(jwtSecret, userPermissionsSvc, "operations.create_header", operationRoles, http.HandlerFunc(discardMovementDraftHandler(operationSvc))))
	mux.Handle("POST /api/movements/{id}/modify", RequirePermission(jwtSecret, userPermissionsSvc, "operations.create_header", operationRoles, http.HandlerFunc(startModifyMovementHandler(operationSvc))))
	mux.Handle("POST /api/movements/{id}/recreate", RequirePermission(jwtSecret, userPermissionsSvc, "operations.create_header", operationRoles, http.HandlerFunc(recreateFromCancelledHandler(operationSvc))))
	mux.Handle("PATCH /api/movements/{id}/cancel", RequirePermission(jwtSecret, userPermissionsSvc, "pending.cancel", allRoles, http.HandlerFunc(cancelMovementHandler(operationSvc))))
	mux.Handle("POST /api/movements/{id}/compra", RequirePermission(jwtSecret, userPermissionsSvc, "operations.compra.execute", operationRoles, http.HandlerFunc(compraHandler(compraSvc))))
	mux.Handle("POST /api/movements/{id}/venta", RequirePermission(jwtSecret, userPermissionsSvc, "operations.venta.execute", operationRoles, http.HandlerFunc(ventaHandler(ventaSvc))))
	mux.Handle("POST /api/movements/{id}/arbitraje", RequirePermission(jwtSecret, userPermissionsSvc, "operations.arbitraje.execute", operationRoles, http.HandlerFunc(arbitrajeHandler(arbitrajeSvc))))
	mux.Handle("POST /api/movements/{id}/transferencia-entre-cuentas", RequirePermission(jwtSecret, userPermissionsSvc, "operations.transferencia_entre_cuentas.execute", operationRoles, http.HandlerFunc(transferenciaEntreCuentasHandler(tecSvc))))
	mux.Handle("POST /api/movements/{id}/ingreso-capital", RequirePermission(jwtSecret, userPermissionsSvc, "operations.ingreso_capital.execute", operationRoles, http.HandlerFunc(ingresoCapitalHandler(ingresoCapitalSvc))))
	mux.Handle("POST /api/movements/{id}/retiro-capital", RequirePermission(jwtSecret, userPermissionsSvc, "operations.retiro_capital.execute", operationRoles, http.HandlerFunc(retiroCapitalHandler(retiroCapitalSvc))))
	mux.Handle("POST /api/movements/{id}/gasto", RequirePermission(jwtSecret, userPermissionsSvc, "operations.gasto.execute", operationRoles, http.HandlerFunc(gastoHandler(gastoSvc))))
	mux.Handle("POST /api/movements/{id}/pago-cc-cruzado", RequirePermission(jwtSecret, userPermissionsSvc, "operations.pago_cc_cruzado.execute", operationRoles, http.HandlerFunc(pagoCCCruzadoHandler(pagoCCSvc))))
	mux.Handle("POST /api/movements/{id}/transferencia", RequirePermission(jwtSecret, userPermissionsSvc, "operations.transferencia.execute", operationRoles, http.HandlerFunc(transferenciaHandler(transferenciaSvc))))
	mux.Handle("POST /api/movements/{id}/traspaso-deuda-cc", RequirePermission(jwtSecret, userPermissionsSvc, "operations.traspaso_deuda_cc.execute", operationRoles, http.HandlerFunc(traspasoDeudaCCHandler(traspasoDeudaCCSvc))))

	// Audit Logs
	auditRoles := []string{"SUPERADMIN", "ADMIN", "SUBADMIN"}
	mux.Handle("GET /api/audit-logs", RequirePermission(jwtSecret, userPermissionsSvc, "audit.view", auditRoles, http.HandlerFunc(listAuditLogsHandler(auditLogsSvc))))

	// Inicio / resumen diario (misma lógica que reportes, permiso dashboard.view)
	mux.Handle("GET /api/dashboard/daily-summary", RequirePermission(jwtSecret, userPermissionsSvc, "dashboard.view", dashboardRoles, http.HandlerFunc(dashboardDailySummaryHandler(reportesSvc))))

	// Cash Position
	cashPositionRoles := []string{"SUPERADMIN", "ADMIN", "SUBADMIN", "OPERATOR"}
	mux.Handle("GET /api/cash-position", RequirePermission(jwtSecret, userPermissionsSvc, "cash_position.view", cashPositionRoles, http.HandlerFunc(cashPositionHandler(cashPosSvc))))

	// Manual FX Quotes
	reportRoles := []string{"SUPERADMIN", "ADMIN", "SUBADMIN"}
	mux.Handle("GET /api/manual-fx-quotes", RequirePermission(jwtSecret, userPermissionsSvc, "manual_fx_quotes.view", reportRoles, http.HandlerFunc(listFXQuotesHandler(fxQuoteRepo))))
	mux.Handle("POST /api/manual-fx-quotes", RequirePermission(jwtSecret, userPermissionsSvc, "manual_fx_quotes.edit", reportRoles, http.HandlerFunc(createFXQuoteHandler(fxQuoteRepo))))
	mux.Handle("PUT /api/manual-fx-quotes/{id}", RequirePermission(jwtSecret, userPermissionsSvc, "manual_fx_quotes.edit", reportRoles, http.HandlerFunc(updateFXQuoteHandler(fxQuoteRepo))))

	// Reportes
	mux.Handle("GET /api/reportes", RequirePermission(jwtSecret, userPermissionsSvc, "reportes.view", reportRoles, http.HandlerFunc(reportesHandler(reportesSvc))))

	// Permissions matrix (SUPERADMIN by default)
	mux.Handle("GET /api/permissions/catalog", RequirePermission(jwtSecret, userPermissionsSvc, "settings.edit", superOnly, http.HandlerFunc(listPermissionsCatalogHandler(permissionsSvc))))
	mux.Handle("GET /api/permissions/roles/{role}", RequirePermission(jwtSecret, userPermissionsSvc, "settings.edit", superOnly, http.HandlerFunc(getRolePermissionsHandler(permissionsSvc))))
	mux.Handle("PUT /api/permissions/roles/{role}", RequirePermission(jwtSecret, userPermissionsSvc, "settings.edit", superOnly, http.HandlerFunc(putRolePermissionsHandler(permissionsSvc))))

	// Pendientes
	mux.Handle("GET /api/pendientes", RequirePermission(jwtSecret, userPermissionsSvc, "pending.view", allRoles, http.HandlerFunc(listPendingHandler(pendingSvc))))
	mux.Handle("PATCH /api/pendientes/{id}/resolver", RequirePermission(jwtSecret, userPermissionsSvc, "pending.resolve", allRoles, http.HandlerFunc(resolvePendingHandler(pendingSvc))))
	mux.Handle("PATCH /api/pendientes/{id}/cancelar", RequirePermission(jwtSecret, userPermissionsSvc, "pending.cancel", allRoles, http.HandlerFunc(cancelPendingHandler(pendingSvc))))

	return CORSMiddleware(mux)
}
