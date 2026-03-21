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

	router := apphttp.NewRouter(pool, cfg.JWTSecret)

	log.Printf("Fina API listening on :%s", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, router); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
