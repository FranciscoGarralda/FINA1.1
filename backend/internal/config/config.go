package config

import "os"

type Config struct {
	DatabaseURLValue string
	Port             string
	JWTSecret        string
}

func Load() *Config {
	dbURL := getEnv("DATABASE_URL", "")
	if dbURL == "" {
		dbURL = "postgres://" + getEnv("DB_USER", "fina") + ":" + getEnv("DB_PASSWORD", "fina") +
			"@" + getEnv("DB_HOST", "localhost") + ":" + getEnv("DB_PORT", "5432") +
			"/" + getEnv("DB_NAME", "fina") + "?sslmode=" + getEnv("DB_SSLMODE", "disable")
	}
	return &Config{
		DatabaseURLValue: dbURL,
		Port:             getEnv("PORT", "8080"),
		JWTSecret:        getEnv("JWT_SECRET", "dev-secret-change-me"),
	}
}

func (c *Config) DatabaseURL() string {
	return c.DatabaseURLValue
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
