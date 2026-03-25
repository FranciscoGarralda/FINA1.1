package services

import (
	"context"
	"errors"
	"sort"

	"fina/internal/repositories"
)

var ErrInvalidRole = errors.New("INVALID_ROLE")

type RolePermissionItem struct {
	Key         string  `json:"key"`
	Module      string  `json:"module"`
	Label       string  `json:"label"`
	Description *string `json:"description,omitempty"`
	Allowed     bool    `json:"allowed"`
}

type RolePermissionUpdate struct {
	Key     string `json:"key"`
	Allowed bool   `json:"allowed"`
}

type PermissionDecision string

const (
	PermissionAllow   PermissionDecision = "ALLOW"
	PermissionDeny    PermissionDecision = "DENY"
	PermissionUnknown PermissionDecision = "UNKNOWN"
)

type PermissionsService struct {
	repo *repositories.PermissionsRepo
}

func NewPermissionsService(repo *repositories.PermissionsRepo) *PermissionsService {
	return &PermissionsService{repo: repo}
}

func IsValidRole(role string) bool {
	_, ok := fallbackRolePermissions[role]
	return ok
}

func (s *PermissionsService) ListCatalog(ctx context.Context) ([]repositories.PermissionCatalogItem, error) {
	items, err := s.repo.ListCatalog(ctx)
	if err != nil {
		if repositories.IsUndefinedTableErr(err) {
			return permissionCatalog, nil
		}
		return nil, err
	}
	if len(items) == 0 {
		return permissionCatalog, nil
	}
	return items, nil
}

func (s *PermissionsService) GetRoleMatrix(ctx context.Context, role string) ([]RolePermissionItem, error) {
	if !IsValidRole(role) {
		return nil, ErrInvalidRole
	}

	rows, err := s.repo.ListRoleMatrix(ctx, role)
	if err != nil {
		if repositories.IsUndefinedTableErr(err) {
			return fallbackMatrixForRole(role), nil
		}
		return nil, err
	}
	if len(rows) == 0 {
		return fallbackMatrixForRole(role), nil
	}

	out := make([]RolePermissionItem, 0, len(rows))
	fallback := fallbackRolePermissions[role]
	for _, row := range rows {
		allowed := fallback[row.Key]
		if row.Allowed != nil {
			allowed = *row.Allowed
		}
		out = append(out, RolePermissionItem{
			Key:         row.Key,
			Module:      row.Module,
			Label:       row.Label,
			Description: row.Description,
			Allowed:     allowed,
		})
	}
	return out, nil
}

func (s *PermissionsService) UpdateRolePermissions(ctx context.Context, role, userID string, items []RolePermissionUpdate) error {
	if !IsValidRole(role) {
		return ErrInvalidRole
	}
	updates := make(map[string]bool, len(items))
	for _, item := range items {
		// Ignore unknown keys to keep endpoint resilient while catalog evolves.
		if !isKnownPermission(item.Key) {
			continue
		}
		updates[item.Key] = item.Allowed
	}
	if len(updates) == 0 {
		return nil
	}
	return s.repo.UpsertRolePermissions(ctx, role, updates, userID)
}

func (s *PermissionsService) CheckPermission(ctx context.Context, role, permissionKey string) (PermissionDecision, error) {
	if !IsValidRole(role) {
		return PermissionDeny, ErrInvalidRole
	}

	allowedPtr, permissionExists, err := s.repo.GetRolePermission(ctx, role, permissionKey)
	if err != nil {
		if repositories.IsUndefinedTableErr(err) {
			return PermissionUnknown, nil
		}
		return PermissionUnknown, err
	}
	if !permissionExists {
		return PermissionUnknown, nil
	}
	if allowedPtr == nil {
		return PermissionUnknown, nil
	}
	if *allowedPtr {
		return PermissionAllow, nil
	}
	return PermissionDeny, nil
}

func (s *PermissionsService) GetEffectivePermissions(ctx context.Context, role string) ([]string, error) {
	matrix, err := s.GetRoleMatrix(ctx, role)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0)
	for _, item := range matrix {
		if item.Allowed {
			out = append(out, item.Key)
		}
	}
	sort.Strings(out)
	return out, nil
}

func FallbackAllows(role, permissionKey string) bool {
	return fallbackRolePermissions[role][permissionKey]
}

func fallbackMatrixForRole(role string) []RolePermissionItem {
	out := make([]RolePermissionItem, 0, len(permissionCatalog))
	for _, p := range permissionCatalog {
		out = append(out, RolePermissionItem{
			Key:         p.Key,
			Module:      p.Module,
			Label:       p.Label,
			Description: p.Description,
			Allowed:     fallbackRolePermissions[role][p.Key],
		})
	}
	return out
}

func isKnownPermission(key string) bool {
	for _, p := range permissionCatalog {
		if p.Key == key {
			return true
		}
	}
	return false
}

var permissionCatalog = []repositories.PermissionCatalogItem{
	{Key: "dashboard.view", Module: "dashboard", Label: "Ver inicio"},
	{Key: "settings.view", Module: "settings", Label: "Ver configuración"},
	{Key: "settings.edit", Module: "settings", Label: "Editar configuración"},
	{Key: "users.view", Module: "users", Label: "Ver usuarios"},
	{Key: "users.create", Module: "users", Label: "Crear usuarios"},
	{Key: "users.edit", Module: "users", Label: "Editar usuarios"},
	{Key: "users.toggle_active", Module: "users", Label: "Activar/Inactivar usuarios"},
	{Key: "users.reset_password", Module: "users", Label: "Resetear contraseña de usuarios"},
	{Key: "permissions.view_user", Module: "users", Label: "Ver permisos de usuario"},
	{Key: "permissions.edit_user", Module: "users", Label: "Editar permisos de usuario"},
	{Key: "permissions.reset_user_to_default", Module: "users", Label: "Restaurar permisos al rol"},
	{Key: "currencies.view", Module: "currencies", Label: "Ver divisas"},
	{Key: "currencies.create", Module: "currencies", Label: "Crear divisas"},
	{Key: "currencies.edit", Module: "currencies", Label: "Editar divisas"},
	{Key: "currencies.toggle_active", Module: "currencies", Label: "Activar/Inactivar divisas"},
	{Key: "accounts.view", Module: "accounts", Label: "Ver cuentas"},
	{Key: "accounts.create", Module: "accounts", Label: "Crear cuentas"},
	{Key: "accounts.edit", Module: "accounts", Label: "Editar cuentas"},
	{Key: "accounts.toggle_active", Module: "accounts", Label: "Activar/Inactivar cuentas"},
	{Key: "accounts.currencies.edit", Module: "accounts", Label: "Editar divisas por cuenta"},
	{Key: "clients.view", Module: "clients", Label: "Ver clientes"},
	{Key: "clients.create", Module: "clients", Label: "Crear clientes"},
	{Key: "clients.edit", Module: "clients", Label: "Editar clientes"},
	{Key: "clients.toggle_active", Module: "clients", Label: "Activar/Inactivar clientes"},
	{Key: "cc.view", Module: "cc", Label: "Ver posiciones CC"},
	{Key: "cc.export_csv", Module: "cc", Label: "Exportar CSV de CC (compartir)"},
	{Key: "movements.view", Module: "movements", Label: "Ver movimientos"},
	{Key: "movements.detail.view", Module: "movements", Label: "Ver detalle de movimiento"},
	{Key: "operations.create_header", Module: "operations", Label: "Crear encabezado de operación"},
	{Key: "operations.compra.execute", Module: "operations", Label: "Ejecutar compra"},
	{Key: "operations.venta.execute", Module: "operations", Label: "Ejecutar venta"},
	{Key: "operations.arbitraje.execute", Module: "operations", Label: "Ejecutar arbitraje"},
	{Key: "operations.transferencia_entre_cuentas.execute", Module: "operations", Label: "Ejecutar transferencia entre cuentas"},
	{Key: "operations.transferencia.execute", Module: "operations", Label: "Ejecutar transferencia"},
	{Key: "operations.ingreso_capital.execute", Module: "operations", Label: "Ejecutar ingreso de capital"},
	{Key: "operations.retiro_capital.execute", Module: "operations", Label: "Ejecutar retiro de capital"},
	{Key: "operations.gasto.execute", Module: "operations", Label: "Ejecutar gasto"},
	{Key: "operations.pago_cc_cruzado.execute", Module: "operations", Label: "Ejecutar pago CC cruzado"},
	{Key: "operations.traspaso_deuda_cc.execute", Module: "operations", Label: "Ejecutar traspaso deuda CC"},
	{Key: "pending.view", Module: "pending", Label: "Ver pendientes"},
	{Key: "pending.resolve", Module: "pending", Label: "Resolver pendientes"},
	{Key: "pending.cancel", Module: "pending", Label: "Cancelar pendientes"},
	{Key: "reportes.view", Module: "reportes", Label: "Ver reportes"},
	{Key: "profile.view", Module: "profile", Label: "Ver perfil"},
	{Key: "profile.change_password", Module: "profile", Label: "Cambiar contraseña propia"},
	{Key: "profile.change_pin", Module: "profile", Label: "Cambiar PIN propio"},
	{Key: "cash_position.view", Module: "cash_position", Label: "Ver posición de caja"},
	{Key: "cash_arqueo.view", Module: "cash_position", Label: "Ver arqueos de caja"},
	{Key: "cash_arqueo.create", Module: "cash_position", Label: "Registrar arqueo de caja"},
}

var fallbackRolePermissions = map[string]map[string]bool{
	"SUPERADMIN": {},
	"ADMIN":      {},
	"SUBADMIN":   {},
	"OPERATOR":   {},
	"COURIER":    {},
}

func init() {
	for role := range fallbackRolePermissions {
		fallbackRolePermissions[role] = make(map[string]bool)
	}

	// SUPERADMIN: all true
	for _, p := range permissionCatalog {
		fallbackRolePermissions["SUPERADMIN"][p.Key] = true
	}

	// ADMIN defaults
	allow("ADMIN",
		"dashboard.view",
		"settings.view",
		"users.view",
		"currencies.view", "currencies.create", "currencies.edit", "currencies.toggle_active",
		"accounts.view", "accounts.create", "accounts.edit", "accounts.toggle_active", "accounts.currencies.edit",
		"clients.view", "clients.create", "clients.edit", "clients.toggle_active",
		"cc.view", "cc.export_csv",
		"movements.view", "movements.detail.view",
		"operations.create_header",
		"operations.compra.execute", "operations.venta.execute", "operations.arbitraje.execute",
		"operations.transferencia_entre_cuentas.execute", "operations.transferencia.execute",
		"operations.ingreso_capital.execute", "operations.retiro_capital.execute",
		"operations.gasto.execute", "operations.pago_cc_cruzado.execute", "operations.traspaso_deuda_cc.execute",
		"pending.view", "pending.resolve", "pending.cancel",
		"reportes.view",
		"profile.view", "profile.change_password",
		"cash_position.view", "cash_arqueo.view", "cash_arqueo.create",
	)

	// SUBADMIN defaults
	allow("SUBADMIN",
		"dashboard.view",
		"settings.view",
		"users.view", "users.create", "users.edit", "users.reset_password",
		"currencies.view", "currencies.create", "currencies.edit", "currencies.toggle_active",
		"accounts.view", "accounts.create", "accounts.edit", "accounts.toggle_active", "accounts.currencies.edit",
		"clients.view", "clients.create", "clients.edit", "clients.toggle_active",
		"cc.view", "cc.export_csv",
		"movements.view", "movements.detail.view",
		"operations.create_header",
		"operations.compra.execute", "operations.venta.execute", "operations.arbitraje.execute",
		"operations.transferencia_entre_cuentas.execute", "operations.transferencia.execute",
		"operations.ingreso_capital.execute", "operations.retiro_capital.execute",
		"operations.gasto.execute", "operations.pago_cc_cruzado.execute", "operations.traspaso_deuda_cc.execute",
		"pending.view", "pending.resolve", "pending.cancel",
		"reportes.view",
		"profile.view", "profile.change_password",
		"cash_position.view", "cash_arqueo.view", "cash_arqueo.create",
	)

	// OPERATOR defaults
	allow("OPERATOR",
		"dashboard.view",
		"currencies.view",
		"accounts.view",
		"clients.view", "clients.create", "clients.edit", "clients.toggle_active",
		"cc.view", "cc.export_csv",
		"movements.view", "movements.detail.view",
		"operations.create_header",
		"operations.compra.execute", "operations.venta.execute", "operations.arbitraje.execute",
		"operations.transferencia_entre_cuentas.execute", "operations.transferencia.execute",
		"operations.ingreso_capital.execute", "operations.retiro_capital.execute",
		"operations.gasto.execute", "operations.pago_cc_cruzado.execute", "operations.traspaso_deuda_cc.execute",
		"pending.view", "pending.resolve", "pending.cancel",
		"profile.view", "profile.change_password",
		"cash_position.view", "cash_arqueo.view", "cash_arqueo.create",
	)

	// COURIER defaults
	allow("COURIER",
		"dashboard.view",
		"clients.view",
		"pending.view", "pending.resolve", "pending.cancel",
		"profile.view", "profile.change_password", "profile.change_pin",
	)
}

func allow(role string, keys ...string) {
	for _, k := range keys {
		fallbackRolePermissions[role][k] = true
	}
}
