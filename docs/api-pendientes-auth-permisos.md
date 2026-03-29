# API: pendientes, anulaciones, login y permisos

Contrato operativo (F-007, F-008, F-009). Complementa [deploy-railway.md](deploy-railway.md) (despliegue); aquí solo rutas y consumidores.

## Anulaciones: movimiento vs pendiente

| Endpoint | Efecto | Permiso |
|----------|--------|---------|
| `PATCH /api/movements/{id}/cancel` | Anula la **operación completa** (reversiones contables/CC según `OperationService.CancelMovement` / `cancelMovementWithinTx`). | `pending.cancel` |
| `PATCH /api/pendientes/{id}/cancelar` | Marca **solo** el pendiente en estado `ABIERTO` como `CANCELADO` (`PendingService.Cancel`); **no** ejecuta el flujo de anulación de movimiento. | `pending.cancel` |

**UI actual (SPA):**

- Pantalla **Pendientes**, modal “Anular operación”: usa `PATCH /api/movements/{movement_id}/cancel` (anula la operación, no `.../pendientes/.../cancelar`).
- **Movimientos** y **detalle de movimiento**: mismo `PATCH /api/movements/{id}/cancel`.

**Regla práctica:** para **deshacer toda la operación** → cancel de **movimiento**. Para dar de baja **solo un pendiente** manteniendo el resto del movimiento confirmado → `PATCH .../pendientes/{id}/cancelar` (hoy **no** expuesto en el front; disponible para API u otras UIs).

## Login y PIN

| Endpoint | Uso |
|----------|-----|
| `POST /api/login` | Usuario + contraseña → JWT. Consume **`LoginPage`** (`frontend/src/pages/LoginPage.tsx`). |
| `POST /api/login/pin` | Usuario + PIN (`AuthService.LoginWithPIN`). El **login web actual no lo llama**; pensado para otros clientes o flujos (p. ej. COURIER sin formulario de contraseña en esa pantalla). |
| `POST /api/users/me/change-pin` | Cambio de PIN del usuario autenticado; en router solo rol **COURIER**. UI: **Mi perfil** cuando el PIN está habilitado. |
| `GET /api/auth/me` | Datos del usuario (incl. flags de PIN según settings). Perfil y formularios de cuenta. |

Alta o actualización de PIN desde administración: flujo de usuarios (`PUT /api/users/{id}` con `pin` cuando aplica, ver `UserFormModal`).

## Permisos

| Endpoint | Quién lo consume (referencia) |
|----------|-------------------------------|
| `GET /api/auth/me/permissions` | **`AuthContext`** tras login: lista de keys efectivas para `can()`. |
| `GET /api/permissions/catalog` | Catálogo maestro de permisos (metadata). Requiere `settings.edit`, rol **SUPERADMIN** (`superOnly` en router). El SPA de matriz por rol **no** llama este path. |
| `GET` / `PUT /api/permissions/roles/{role}` | **`PermisosTab`** (Configuración): carga y guarda la matriz por rol. |
| `GET` / `PUT` / `DELETE .../users/{id}/permissions` | Modales de permisos por usuario (**superadmin**). |

## Referencia de código

- Registro de rutas: `backend/internal/http/router.go`.
- Cancel pendiente: `backend/internal/services/pending_service.go` (`Cancel`).
- Cancel movimiento: `backend/internal/services/operation_service.go` (`CancelMovement`).
