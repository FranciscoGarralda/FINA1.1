package services

import (
	"context"
	"errors"
	"sort"

	"fina/internal/repositories"
)

var ErrUserNotFound = errors.New("USER_NOT_FOUND")

type UserPermissionMatrixItem struct {
	Key         string  `json:"key"`
	Module      string  `json:"module"`
	Label       string  `json:"label"`
	Description *string `json:"description,omitempty"`
	Source      string  `json:"source"` // USER | ROLE | FALLBACK
	Allowed     bool    `json:"allowed"`
}

type UserPermissionUpdate struct {
	Key     string `json:"key"`
	Allowed bool   `json:"allowed"`
}

type UserPermissionsService struct {
	permissionsSvc *PermissionsService
	userRepo       *repositories.UserRepo
	userPermRepo   *repositories.UserPermissionsRepo
	auditRepo      *repositories.AuditRepo
}

func NewUserPermissionsService(
	permissionsSvc *PermissionsService,
	userRepo *repositories.UserRepo,
	userPermRepo *repositories.UserPermissionsRepo,
	auditRepo *repositories.AuditRepo,
) *UserPermissionsService {
	return &UserPermissionsService{
		permissionsSvc: permissionsSvc,
		userRepo:       userRepo,
		userPermRepo:   userPermRepo,
		auditRepo:      auditRepo,
	}
}

func (s *UserPermissionsService) ResolvePermission(ctx context.Context, userID, role, permissionKey string) (PermissionDecision, error) {
	// 1) USER override
	overrides, err := s.userPermRepo.ListOverrides(ctx, userID)
	if err != nil {
		if repositories.IsUndefinedTableErr(err) {
			// ignore and continue to role/fallback
		} else {
			return PermissionUnknown, err
		}
	} else {
		for _, o := range overrides {
			if o.Key == permissionKey {
				if o.Allowed {
					return PermissionAllow, nil
				}
				return PermissionDeny, nil
			}
		}
	}

	// 2) ROLE matrix
	roleDecision, err := s.permissionsSvc.CheckPermission(ctx, role, permissionKey)
	if err != nil {
		return PermissionUnknown, err
	}
	if roleDecision != PermissionUnknown {
		return roleDecision, nil
	}

	// 3) Legacy fallback
	if FallbackAllows(role, permissionKey) {
		return PermissionAllow, nil
	}
	return PermissionDeny, nil
}

func (s *UserPermissionsService) GetEffectivePermissions(ctx context.Context, userID, role string) ([]string, error) {
	catalog, err := s.permissionsSvc.ListCatalog(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0)
	for _, p := range catalog {
		decision, err := s.ResolvePermission(ctx, userID, role, p.Key)
		if err != nil {
			return nil, err
		}
		if decision == PermissionAllow {
			out = append(out, p.Key)
		}
	}
	sort.Strings(out)
	return out, nil
}

func (s *UserPermissionsService) GetUserPermissionMatrix(ctx context.Context, userID string) (string, []UserPermissionMatrixItem, error) {
	user, err := s.userRepo.FindByID(ctx, userID)
	if err != nil {
		if errors.Is(err, repositories.ErrNotFound) {
			return "", nil, ErrUserNotFound
		}
		return "", nil, err
	}

	catalog, err := s.permissionsSvc.ListCatalog(ctx)
	if err != nil {
		return "", nil, err
	}

	userOverrides := map[string]bool{}
	overrides, err := s.userPermRepo.ListOverrides(ctx, userID)
	if err != nil && !repositories.IsUndefinedTableErr(err) {
		return "", nil, err
	}
	for _, o := range overrides {
		userOverrides[o.Key] = o.Allowed
	}

	roleMatrix, err := s.permissionsSvc.GetRoleMatrix(ctx, user.Role)
	if err != nil {
		return "", nil, err
	}
	roleMap := make(map[string]bool, len(roleMatrix))
	for _, item := range roleMatrix {
		roleMap[item.Key] = item.Allowed
	}

	items := make([]UserPermissionMatrixItem, 0, len(catalog))
	for _, p := range catalog {
		source := "FALLBACK"
		allowed := FallbackAllows(user.Role, p.Key)

		if roleAllowed, ok := roleMap[p.Key]; ok {
			source = "ROLE"
			allowed = roleAllowed
		}

		if userAllowed, ok := userOverrides[p.Key]; ok {
			source = "USER"
			allowed = userAllowed
		}

		items = append(items, UserPermissionMatrixItem{
			Key:         p.Key,
			Module:      p.Module,
			Label:       p.Label,
			Description: p.Description,
			Source:      source,
			Allowed:     allowed,
		})
	}

	return user.Role, items, nil
}

func (s *UserPermissionsService) UpsertUserPermissions(ctx context.Context, targetUserID, updatedBy string, updates []UserPermissionUpdate) error {
	beforeRole, beforeItems, err := s.GetUserPermissionMatrix(ctx, targetUserID)
	if err != nil {
		return err
	}

	if _, err := s.userRepo.FindByID(ctx, targetUserID); err != nil {
		if errors.Is(err, repositories.ErrNotFound) {
			return ErrUserNotFound
		}
		return err
	}

	payload := make(map[string]bool, len(updates))
	for _, u := range updates {
		if u.Key == "" {
			continue
		}
		payload[u.Key] = u.Allowed
	}
	if len(payload) == 0 {
		return nil
	}
	if err := s.userPermRepo.UpsertBatch(ctx, targetUserID, updatedBy, payload); err != nil {
		return err
	}

	// Overrides ya persistidos; si falla la lectura de la matriz, el cliente recibe error (posible desalineación con audit).
	_, afterItems, err := s.GetUserPermissionMatrix(ctx, targetUserID)
	if err != nil {
		return err
	}
	s.auditRepo.Insert(ctx, "user", &targetUserID, "update_user_permissions",
		map[string]interface{}{"role": beforeRole, "items": beforeItems},
		map[string]interface{}{"role": beforeRole, "items": afterItems},
		updatedBy)
	return nil
}

func (s *UserPermissionsService) ClearUserOverrides(ctx context.Context, targetUserID, updatedBy string) error {
	beforeRole, beforeItems, err := s.GetUserPermissionMatrix(ctx, targetUserID)
	if err != nil {
		return err
	}

	if _, err := s.userRepo.FindByID(ctx, targetUserID); err != nil {
		if errors.Is(err, repositories.ErrNotFound) {
			return ErrUserNotFound
		}
		return err
	}
	if err := s.userPermRepo.DeleteOverrides(ctx, targetUserID); err != nil {
		return err
	}
	// Borrado de overrides ya aplicado; si falla la matriz "after", el cliente recibe error sin audit completo.
	_, afterItems, err := s.GetUserPermissionMatrix(ctx, targetUserID)
	if err != nil {
		return err
	}
	s.auditRepo.Insert(ctx, "user", &targetUserID, "reset_user_permissions",
		map[string]interface{}{"role": beforeRole, "items": beforeItems},
		map[string]interface{}{"role": beforeRole, "items": afterItems},
		updatedBy)
	return nil
}
