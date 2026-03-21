# Fina — Currency Exchange System

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
