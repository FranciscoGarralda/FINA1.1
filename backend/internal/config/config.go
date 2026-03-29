package config

import (
	"log"
	"net/url"
	"os"
	"strings"
)

// DefaultJWTSecret is only for local development. Production and any environment
// that sets REQUIRE_JWT_SECRET, FINA_ENV/APP_ENV=production, or Railway production
// must set JWT_SECRET to a strong random value.
const DefaultJWTSecret = "dev-secret-change-me"

type Config struct {
	DatabaseURLValue string
	Port             string
	JWTSecret        string
	SkipDBMigrate    bool
	// CORSExplicitOrigins is non-empty when CORS_ALLOWED_ORIGINS was set (comma-separated).
	// When empty, CORSDevLocalhost selects the built-in localhost/127.0.0.1 dev allowlist.
	CORSExplicitOrigins []string
	CORSDevLocalhost    bool
}

func Load() *Config {
	dbURL := getEnv("DATABASE_URL", "")
	if dbURL == "" {
		dbURL = "postgres://" + getEnv("DB_USER", "fina") + ":" + getEnv("DB_PASSWORD", "fina") +
			"@" + getEnv("DB_HOST", "localhost") + ":" + getEnv("DB_PORT", "5432") +
			"/" + getEnv("DB_NAME", "fina") + "?sslmode=" + getEnv("DB_SSLMODE", "disable")
	}

	explicit, devLocal := parseCORSAllowedOrigins()

	cfg := &Config{
		DatabaseURLValue:    dbURL,
		Port:                getEnv("PORT", "8080"),
		JWTSecret:           getEnv("JWT_SECRET", DefaultJWTSecret),
		SkipDBMigrate:       isTruthyEnv("SKIP_DB_MIGRATE"),
		CORSExplicitOrigins: explicit,
		CORSDevLocalhost:    devLocal,
	}

	enforceJWTSecretPolicy(cfg.JWTSecret)
	return cfg
}

func parseCORSAllowedOrigins() (explicit []string, devLocalhost bool) {
	raw := strings.TrimSpace(os.Getenv("CORS_ALLOWED_ORIGINS"))
	if raw == "" {
		return nil, true
	}
	for _, part := range strings.Split(raw, ",") {
		p := strings.TrimSpace(part)
		if p != "" {
			explicit = append(explicit, p)
		}
	}
	if len(explicit) == 0 {
		return nil, true
	}
	return explicit, false
}

func enforceJWTSecretPolicy(jwtSecret string) {
	if !mustRequireStrongJWT() {
		return
	}
	if strings.TrimSpace(jwtSecret) == "" || jwtSecret == DefaultJWTSecret {
		log.Fatalf("JWT_SECRET: en este entorno debe definirse un secreto fuerte (no el valor por defecto de desarrollo). " +
			"Activa esta exigencia con REQUIRE_JWT_SECRET=1, FINA_ENV/APP_ENV=production, o RAILWAY_ENVIRONMENT=production. " +
			"Configurá JWT_SECRET en variables de entorno.")
	}
}

func mustRequireStrongJWT() bool {
	if isTruthyEnv("REQUIRE_JWT_SECRET") {
		return true
	}
	if envIsProduction("FINA_ENV") || envIsProduction("APP_ENV") {
		return true
	}
	if strings.EqualFold(strings.TrimSpace(os.Getenv("RAILWAY_ENVIRONMENT")), "production") {
		return true
	}
	return false
}

func envIsProduction(key string) bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv(key)), "production")
}

// CORSAllowOrigin returns whether origin is allowed and the exact value for Access-Control-Allow-Origin.
func (c *Config) CORSAllowOrigin(origin string) (allowOrigin string, ok bool) {
	if origin == "" {
		return "", false
	}
	if len(c.CORSExplicitOrigins) > 0 {
		for _, o := range c.CORSExplicitOrigins {
			if o == origin {
				return origin, true
			}
		}
		return "", false
	}
	if c.CORSDevLocalhost && isDevLocalhostOrigin(origin) {
		return origin, true
	}
	return "", false
}

func isDevLocalhostOrigin(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil || u.Scheme != "http" {
		return false
	}
	if u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
		return false
	}
	host := u.Hostname()
	if host != "localhost" && host != "127.0.0.1" {
		return false
	}
	port := u.Port()
	if port == "" {
		return false
	}
	switch port {
	case "5173", "5174", "3000":
		return true
	default:
		return false
	}
}

func isTruthyEnv(key string) bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv(key)))
	return v == "1" || v == "true" || v == "yes"
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
