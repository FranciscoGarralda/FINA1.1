package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

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

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	go func() {
		log.Printf("Fina API listening on :%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	sigCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	<-sigCtx.Done()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("server shutdown: %v", err)
	}
}
