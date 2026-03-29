package main

import (
	"context"
	"log"
	"net/http"

	"fina/internal/config"
	"fina/internal/db"
	apphttp "fina/internal/http"

	"github.com/joho/godotenv"
)

func main() {
	godotenv.Load(".env", "../.env", "../../.env")

	ctx := context.Background()
	cfg := config.Load()

	pool, err := db.Connect(ctx, cfg.DatabaseURL())
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}
	defer pool.Close()

	if !cfg.SkipDBMigrate {
		dir := db.ResolveMigrationsDir()
		if err := db.MigrateUp(cfg.DatabaseURL(), dir); err != nil {
			log.Fatalf("database migrations: %v", err)
		}
		log.Printf("database migrations: ok (dir=%s)", dir)
	} else {
		log.Printf("database migrations: skipped (SKIP_DB_MIGRATE set)")
	}

	router := apphttp.NewRouter(pool, cfg)

	log.Printf("Fina API listening on :%s", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, router); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
