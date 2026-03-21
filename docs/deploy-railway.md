# Despliegue en Railway (API Go)

Documento único para operar el backend en Railway. No duplicar este checklist en otros archivos; enlazar desde el README.

## 1. Requisitos en Railway

- Proyecto con **PostgreSQL** (plugin) y servicio que ejecuta la imagen construida desde este repo.
- Repositorio conectado; el build usa **`railway.json`** → builder **DOCKERFILE**, `dockerfilePath: backend/Dockerfile`.
- El **contexto de Docker** es la **raíz del monorepo** (no solo `backend/`). El Dockerfile ya copia `backend/go.mod`, `backend/go.sum` y `backend/`.

## 2. Variables de entorno del servicio API

| Variable        | Obligatorio | Notas |
|----------------|-------------|--------|
| `DATABASE_URL` | Sí          | URL que provee Railway al vincular el plugin Postgres al servicio, o copiada desde la base. Sin esto el proceso termina en `log.Fatalf` al conectar y **no escucha** (el healthcheck falla). |
| `JWT_SECRET`   | Sí (prod)   | Valor aleatorio fuerte. No usar `dev-secret-change-me` en producción. |
| `PORT`         | Suele inyectarlo Railway | El API usa `PORT` (ver `backend/internal/config`). |

No commitear secretos; configurar solo en el panel de Railway.

## 3. Migraciones (regla única)

1. La base Postgres del entorno debe existir y ser alcanzable desde donde ejecutes el comando.
2. Ejecutar **antes** de considerar el servicio listo para uso real:

```bash
migrate -path backend/migrations -database "$DATABASE_URL" up
```

Usar la misma `DATABASE_URL` que el servicio en Railway (desde tu máquina con red permitida, o desde un job one-shot / pre-deploy si lo configurás en la plataforma).

**Pre-deploy en Railway:** opcional; la regla por defecto del proyecto es **migrar antes de tráfico**, sea manual o automatizada.

## 4. Docker y build

- Raíz del repo: `docker build -f backend/Dockerfile .`
- `.dockerignore` en la raíz reduce contexto (node_modules, .env, etc.).

## 5. Healthcheck falla (`/health`)

El endpoint `GET /health` es público y responde JSON `{"status":"ok"}` **solo si el servidor HTTP ya está escuchando**.

En `backend/cmd/api/main.go` la conexión a la base ocurre **antes** de `ListenAndServe`. Si la DB no conecta, el proceso **no llega a abrir el puerto** → el healthcheck devuelve *service unavailable*.

**Qué revisar primero:** **Deploy logs** (no solo Build logs). Buscar `failed to connect to database`. Corregir `DATABASE_URL` o disponibilidad de Postgres.

## 6. Frontend en producción

El cliente HTTP usa `VITE_API_BASE` en tiempo de **build** (Vite). Si el front se sirve en otro dominio que el API:

- Definir `VITE_API_BASE` como URL absoluta que **termina en `/api`** (ej. `https://tu-servicio-api.up.railway.app/api`).
- Rebuild del front si cambia la URL del API.

Ver `frontend/.env.example` y `frontend/src/api/client.ts`.

## 7. CORS

El middleware en `backend/internal/http/cors.go` refleja `Access-Control-Allow-Origin` con el header `Origin` de la petición y permite credenciales. Si el navegador bloquea peticiones, comprobar origen, HTTPS y que el front apunte al API correcto (`VITE_API_BASE`).

## 8. Alcance y reglas de oro

Las tareas de **despliegue e infraestructura** no deben mezclar cambios de lógica de negocio, cuentas reales vs CC vs pendientes, ni auditoría, salvo pedido explícito y separado. Cambios mínimos; decisiones críticas documentadas aquí o en el PR.

## 9. Verificación local del código

Tras cambios en backend / frontend:

```bash
cd backend && go test ./...
cd frontend && npm run build
```
