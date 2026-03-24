# Fina — Currency Exchange System

## Despliegue (Railway)

Guía única: **[docs/deploy-railway.md](docs/deploy-railway.md)** (variables, migraciones, Docker, healthcheck, front en producción).

## Prerequisites

- Docker & Docker Compose
- Go 1.22+
- [golang-migrate CLI](https://github.com/golang-migrate/migrate/tree/master/cmd/migrate)

### Install golang-migrate (macOS)

```bash
brew install golang-migrate
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

## Arranque local completo (Postgres + migraciones)

1. Docker Desktop encendido.
2. Desde la raíz del repo:

```bash
./scripts/start-local.sh
```

3. En dos terminales: API (`cd backend && go run ./cmd/api`) y front (`cd frontend && npm run dev`). Front: [http://localhost:5173](http://localhost:5173), API: puerto `8080`.
