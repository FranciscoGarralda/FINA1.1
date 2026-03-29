package http

import (
	"net/http"

	"fina/internal/config"
)

// CORSMiddleware applies CORS using cfg.CORSAllowOrigin (allowlist or dev localhost rules).
// If the request Origin is not allowed, it does not set Access-Control-Allow-Origin nor credentials.
func CORSMiddleware(next http.Handler, cfg *config.Config) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if allowOrigin, ok := cfg.CORSAllowOrigin(origin); ok {
			w.Header().Set("Access-Control-Allow-Origin", allowOrigin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}
