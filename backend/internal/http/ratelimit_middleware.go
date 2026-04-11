package http

import (
	"encoding/json"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// loginRateLimiter limita requests al endpoint de login por IP.
// Usa una ventana fija de 1 minuto con un máximo de 10 intentos.
// Las IPs inactivas por más de 5 minutos se limpian automáticamente.
var loginRateLimiter = newIPRateLimiter(10, time.Minute)

type ipEntry struct {
	count       int
	windowStart time.Time
	lastSeen    time.Time
}

type ipRateLimiter struct {
	mu       sync.Mutex
	entries  map[string]*ipEntry
	limit    int
	window   time.Duration
}

func newIPRateLimiter(limit int, window time.Duration) *ipRateLimiter {
	rl := &ipRateLimiter{
		entries: make(map[string]*ipEntry),
		limit:   limit,
		window:  window,
	}
	go rl.cleanupLoop()
	return rl
}

// allow devuelve true si la IP puede continuar, false si superó el límite.
func (rl *ipRateLimiter) allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	e, ok := rl.entries[ip]
	if !ok {
		rl.entries[ip] = &ipEntry{count: 1, windowStart: now, lastSeen: now}
		return true
	}

	// Si la ventana expiró, reiniciar el contador.
	if now.Sub(e.windowStart) > rl.window {
		e.count = 1
		e.windowStart = now
		e.lastSeen = now
		return true
	}

	e.lastSeen = now
	if e.count >= rl.limit {
		return false
	}
	e.count++
	return true
}

// cleanupLoop elimina entradas inactivas cada 5 minutos para evitar memory leaks.
func (rl *ipRateLimiter) cleanupLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		rl.mu.Lock()
		cutoff := time.Now().Add(-5 * time.Minute)
		for ip, e := range rl.entries {
			if e.lastSeen.Before(cutoff) {
				delete(rl.entries, ip)
			}
		}
		rl.mu.Unlock()
	}
}

// LoginRateLimitMiddleware aplica rate limiting por IP solo a los endpoints de login.
// Límite: 10 requests por minuto por IP.
func LoginRateLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		if !loginRateLimiter.allow(ip) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			json.NewEncoder(w).Encode(map[string]string{
				"error":   "TOO_MANY_REQUESTS",
				"message": "Demasiados intentos. Esperá un momento e intentá de nuevo.",
			})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// clientIP extrae la IP real del cliente, considerando proxies como Railway.
func clientIP(r *http.Request) string {
	// X-Forwarded-For puede tener múltiples IPs: "client, proxy1, proxy2"
	// La primera es la del cliente real.
	if xff := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); xff != "" {
		parts := strings.SplitN(xff, ",", 2)
		if ip := strings.TrimSpace(parts[0]); ip != "" {
			return ip
		}
	}
	// Fallback a RemoteAddr (formato "host:port" o "[::1]:port")
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
