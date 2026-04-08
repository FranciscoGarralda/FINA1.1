# Fina — Currency Exchange System

## Despliegue (Railway)

Guía única: **[docs/deploy-railway.md](docs/deploy-railway.md)** (variables, migraciones, Docker, healthcheck, front en producción). Contrato API pendientes / login / permisos: **[docs/api-pendientes-auth-permisos.md](docs/api-pendientes-auth-permisos.md)**.

Desarrollo local, troubleshooting y migraciones en local: **[docs/local-dev.md](docs/local-dev.md)**.

## CI (GitHub Actions)

En cada **push** y **pull request**, el workflow **[`.github/workflows/ci.yml`](.github/workflows/ci.yml)** ejecuta, en orden:

1. **Backend:** `go vet ./...`, `go test ./...`, `go build ./...`
2. **golangci-lint** v2 (config en [`backend/.golangci.yml`](backend/.golangci.yml))
3. **govulncheck** sobre el módulo del API
4. **Frontend:** `npm ci`, `npm run lint`, `npm run build` (Node 22)

Si el workflow falla, revisá el log del step en **Actions** en GitHub.

Simulación local equivalente (desde la raíz del repo):

```bash
cd backend && go vet ./... && go test ./... && go build ./...
cd backend && golangci-lint run ./...
cd backend && go install golang.org/x/vuln/cmd/govulncheck@latest && "$(go env GOPATH)/bin/govulncheck" ./...
cd frontend && npm ci && npm run lint && npm run build
```

## Requisitos

- Docker y Docker Compose
- Go **1.25.9+** (alineado con `backend/go.mod` y `backend/Dockerfile`; cubre avisos recientes de `govulncheck` sobre stdlib)
- [CLI golang-migrate](https://github.com/golang-migrate/migrate/tree/master/cmd/migrate) (obligatoria para `./scripts/start-local.sh` y para comandos `migrate` manuales; **no** hace falta en PATH para `./scripts/run-local-dev.sh`, que solo migra vía el API)

### Instalar golang-migrate (macOS)

```bash
brew install golang-migrate
```

### Vulnerabilidades en dependencias Go (opcional)

Para listar vulnerabilidades conocidas en el módulo del API (además de `go test`):

```bash
go install golang.org/x/vuln/cmd/govulncheck@latest
cd backend
govulncheck ./...
```

`govulncheck` no modifica el código ni el `go.sum`; solo informa. El mismo chequeo corre en **CI** (ver [CI (GitHub Actions)](#ci-github-actions)).

### Lint Go (opcional)

El proyecto usa **golangci-lint v2** y `version: "2"` en [`backend/.golangci.yml`](backend/.golangci.yml). Instalación alineada con CI (ejemplo de versión pinneada):

```bash
go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.11.0
cd backend
golangci-lint run ./...
```

Con Homebrew u otros métodos, asegurate de que el binario sea **v2** y compatible con la versión de Go del `go.mod`. Documentación: [golangci-lint.run](https://golangci-lint.run/welcome/install/).

### Lint frontend (ESLint)

```bash
cd frontend
npm run lint
```

## PostgreSQL local

```bash
docker compose up -d
```

Levanta PostgreSQL en `localhost:5432` con:

- Usuario: `fina`
- Contraseña: `fina`
- Base: `fina`

(Volumen Docker: `pgdata` en `docker-compose.yml`.)

## Migraciones

Si ya levantás el API, las migraciones se aplican solas al inicio (ver **Ejecutar el API**); los comandos de abajo sirven para ejecutar `migrate` a mano sin arrancar el servidor.

```bash
migrate -path backend/migrations -database "postgres://fina:fina@localhost:5432/fina?sslmode=disable" up
```

## Revertir migraciones (`migrate down`)

```bash
migrate -path backend/migrations -database "postgres://fina:fina@localhost:5432/fina?sslmode=disable" down
```

**No uses `migrate down` para borrar datos operativos** (movimientos, clientes, etc.): revierte **esquema**, no sustituye un reset de datos. Para vaciar datos operativos con criterio, ver **[scripts/README-reset-operational-data.md](scripts/README-reset-operational-data.md)**.

## Ejecutar el API

```bash
cd backend
go run ./cmd/api
```

Al arrancar, el API ejecuta `migrate up` de forma automática e idempotente antes de escuchar HTTP, salvo `SKIP_DB_MIGRATE=true`. La carpeta de los `.sql` la define **`MIGRATIONS_PATH`**; si no está definida, se usa `migrations` o `backend/migrations` según el directorio de trabajo (`ResolveMigrationsDir` en el código). Producción, Docker y variables: **[docs/deploy-railway.md](docs/deploy-railway.md)**.

## Arranque local: scripts, puertos y logs

| Script | Requisitos en PATH / entorno | Migraciones | URLs / puertos | Logs (si aplica) | Detener |
|--------|------------------------------|-------------|----------------|------------------|---------|
| `./scripts/start-local.sh` | Docker, **`migrate`**, `nc` recomendado; **Go y Node** para las dos terminales que el script indica después | **`migrate up` explícito** en shell antes de indicarte las dos terminales | Postgres `5432`; luego vos: API **8080**, Vite **5173** | Salida de la misma terminal del script | Cerrar las terminales donde corren API y front |
| `./scripts/run-local-dev.sh` | Docker, **Go**, **Node** (`npm ci` la primera vez si falta `node_modules`); `nc` y `curl` recomendados | Solo **vía API** al arrancar (`MigrateUp` en el proceso) | Front [http://localhost:5173](http://localhost:5173), API [http://localhost:8080/health](http://localhost:8080/health) | `/tmp/fina-local-api.log`, `/tmp/fina-local-front.log` | `kill "$(cat /tmp/fina-local-api.pid)" "$(cat /tmp/fina-local-front.pid)"` (también lo imprime el script al final) |

**Flujo recomendado con migraciones explícitas en terminal:** Docker Desktop encendido → desde la raíz `./scripts/start-local.sh` → en dos terminales: `cd backend && go run ./cmd/api` y `cd frontend && npm run dev`.

**Flujo en segundo plano (API + Vite):** Docker Desktop encendido → desde la raíz `chmod +x scripts/run-local-dev.sh && ./scripts/run-local-dev.sh` (en macOS puede abrir el navegador).

Si `./scripts/...` devuelve **Permission denied**, ejecutá `chmod +x scripts/*.sh` (ver **[docs/local-dev.md](docs/local-dev.md)**).

**Problemas comunes (local):** **[docs/local-dev.md](docs/local-dev.md)** (`docker`, `/health`, `Dirty database version`, volumen `pgdata`, etc.).

### API: CORS y JWT en local vs producción

- **CORS:** si no definís `CORS_ALLOWED_ORIGINS`, el API solo permite orígenes de desarrollo HTTP en `localhost` / `127.0.0.1` con puertos `5173`, `5174` o `3000` (coincide con Vite). Si definís la lista pero tu entorno local **no** exige JWT de producción (`REQUIRE_JWT_SECRET`, `FINA_ENV=production`, etc.), esos puertos de Vite se aceptan **además** de la lista (útil con `.env` copiado de Railway). En producción endurecida solo valen los orígenes explícitos. En prod con front en otro dominio, definí `CORS_ALLOWED_ORIGINS` (ver [docs/deploy-railway.md](docs/deploy-railway.md)).
- **JWT:** sin variables de entorno, se usa un secreto por defecto solo para desarrollo. En Railway, `RAILWAY_ENVIRONMENT=production` hace que el proceso exija `JWT_SECRET` real; también podés forzar con `REQUIRE_JWT_SECRET=1` o `FINA_ENV=production` / `APP_ENV=production`.
