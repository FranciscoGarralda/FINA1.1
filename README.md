# Fina — Currency Exchange System

## Despliegue (Railway)

Guía única: **[docs/deploy-railway.md](docs/deploy-railway.md)** (variables, migraciones, Docker, healthcheck, front en producción). Contrato API pendientes / login / permisos: **[docs/api-pendientes-auth-permisos.md](docs/api-pendientes-auth-permisos.md)**.

## Prerequisites

- Docker & Docker Compose
- Go 1.22+
- [golang-migrate CLI](https://github.com/golang-migrate/migrate/tree/master/cmd/migrate)

### Install golang-migrate (macOS)

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

`govulncheck` no modifica el código ni el `go.sum`; solo informa. Integrarlo en CI queda para el plan de workflows (p. ej. job en GitHub Actions).

### Lint Go (opcional)

Requiere [golangci-lint](https://golangci-lint.run/) instalado (`brew install golangci-lint` o `go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest`).

```bash
cd backend
golangci-lint run ./...
```

La configuración está en [`backend/.golangci.yml`](backend/.golangci.yml).

### Lint frontend (ESLint)

```bash
cd frontend
npm run lint
```

## Run PostgreSQL

```bash
docker compose up -d
```

This starts PostgreSQL on `localhost:5432` with:
- User: `fina`
- Password: `fina`
- Database: `fina`

## Run Migrations

Si ya levantás el API, las migraciones se aplican solas al inicio (ver **Run Backend**); los comandos de abajo sirven para ejecutar `migrate` a mano sin arrancar el servidor.

```bash
migrate -path backend/migrations -database "postgres://fina:fina@localhost:5432/fina?sslmode=disable" up
```

## Rollback Migrations

```bash
migrate -path backend/migrations -database "postgres://fina:fina@localhost:5432/fina?sslmode=disable" down
```

## Run Backend

```bash
cd backend
go run ./cmd/api
```

Al arrancar, el API ejecuta `migrate up` de forma automática e idempotente antes de escuchar HTTP, salvo `SKIP_DB_MIGRATE=true`. La carpeta de los `.sql` la define **`MIGRATIONS_PATH`**; si no está definida, se usa `migrations` o `backend/migrations` según el directorio de trabajo (`ResolveMigrationsDir` en el código). Producción, Docker y variables: **[docs/deploy-railway.md](docs/deploy-railway.md)**.

## Arranque local completo (Postgres + migraciones)

1. Docker Desktop encendido.
2. Desde la raíz del repo:

```bash
./scripts/start-local.sh
```

3. En dos terminales: API (`cd backend && go run ./cmd/api`) y front (`cd frontend && npm run dev`). Front: [http://localhost:5173](http://localhost:5173), API: puerto `8080`.

**Alternativa (una sola orden, API + Vite en segundo plano):** con Docker Desktop abierto, desde la raíz ejecutá `chmod +x scripts/run-local-dev.sh && ./scripts/run-local-dev.sh` (levanta `docker compose`, espera `/health`, `npm ci` si hace falta, y en macOS abre el navegador). Logs en `/tmp/fina-local-api.log` y `/tmp/fina-local-front.log`.

### API: CORS y JWT en local vs producción

- **CORS:** si no definís `CORS_ALLOWED_ORIGINS`, el API solo permite orígenes de desarrollo HTTP en `localhost` / `127.0.0.1` con puertos `5173`, `5174` o `3000` (coincide con Vite). Si definís la lista pero tu entorno local **no** exige JWT de producción (`REQUIRE_JWT_SECRET`, `FINA_ENV=production`, etc.), esos puertos de Vite se aceptan **además** de la lista (útil con `.env` copiado de Railway). En producción endurecida solo valen los orígenes explícitos. En prod con front en otro dominio, definí `CORS_ALLOWED_ORIGINS` (ver [docs/deploy-railway.md](docs/deploy-railway.md)).
- **JWT:** sin variables de entorno, se usa un secreto por defecto solo para desarrollo. En Railway, `RAILWAY_ENVIRONMENT=production` hace que el proceso exija `JWT_SECRET` real; también podés forzar con `REQUIRE_JWT_SECRET=1` o `FINA_ENV=production` / `APP_ENV=production`.
