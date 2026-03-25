package db

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	_ "github.com/golang-migrate/migrate/v4/source/file"
)

// MigrateUp aplica migraciones SQL pendientes. Es idempotente (si ya están aplicadas, no hace nada).
// Usa bloqueo en Postgres si varias instancias arrancan a la vez.
// databaseURL: típico postgres:// o postgresql:// (Railway).
// migrationsDir: directorio absoluto o relativo al cwd con los .sql (p. ej. /app/migrations en Docker).
func MigrateUp(databaseURL, migrationsDir string) error {
	absDir, err := filepath.Abs(migrationsDir)
	if err != nil {
		return fmt.Errorf("migrations path abs: %w", err)
	}
	if st, err := os.Stat(absDir); err != nil || !st.IsDir() {
		return fmt.Errorf("migrations dir missing or not a directory: %s", absDir)
	}

	fileURL := "file://" + filepath.ToSlash(absDir)
	dsn := toMigratePgx5DSN(databaseURL)

	m, err := migrate.New(fileURL, dsn)
	if err != nil {
		return fmt.Errorf("migrate init: %w", err)
	}
	defer func() {
		_, _ = m.Close()
	}()

	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("migrate up: %w", err)
	}
	return nil
}

// toMigratePgx5DSN convierte URLs estándar al esquema que espera el driver pgx/v5 de golang-migrate.
func toMigratePgx5DSN(url string) string {
	u := strings.TrimSpace(url)
	for _, prefix := range []string{"postgresql://", "postgres://"} {
		if strings.HasPrefix(u, prefix) {
			return "pgx5://" + strings.TrimPrefix(u, prefix)
		}
	}
	return u
}

// ResolveMigrationsDir elige directorio de migraciones: env MIGRATIONS_PATH, o ./migrations, o ./backend/migrations.
func ResolveMigrationsDir() string {
	if p := strings.TrimSpace(os.Getenv("MIGRATIONS_PATH")); p != "" {
		return p
	}
	for _, c := range []string{"migrations", "backend/migrations"} {
		if st, err := os.Stat(c); err == nil && st.IsDir() {
			return c
		}
	}
	return "migrations"
}
