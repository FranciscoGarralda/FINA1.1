// upsert-login-user crea o actualiza un usuario para login con contraseña (bcrypt, mismo costo que la API).
// Ejecutar solo desde tu máquina con DATABASE_URL apuntando a la base deseada (p. ej. DATABASE_PUBLIC_URL de Railway).
// No commitear secretos.
//
//	export DATABASE_URL='...'
//	export BOOTSTRAP_USERNAME='FG'
//	export BOOTSTRAP_PASSWORD='...'
//	export BOOTSTRAP_ROLE='SUPERADMIN'   # opcional
//	export BOOTSTRAP_CONFIRM='yes'
//	cd backend && go run ./cmd/upsert-login-user
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"

	"fina/internal/db"

	"golang.org/x/crypto/bcrypt"
)

var allowedRoles = map[string]struct{}{
	"SUPERADMIN": {}, "ADMIN": {}, "SUBADMIN": {}, "OPERATOR": {}, "COURIER": {},
}

func main() {
	ctx := context.Background()

	if strings.TrimSpace(os.Getenv("BOOTSTRAP_CONFIRM")) != "yes" {
		log.Fatal("set BOOTSTRAP_CONFIRM=yes to run (safety guard)")
	}

	dbURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dbURL == "" {
		log.Fatal("DATABASE_URL is required")
	}

	username := strings.TrimSpace(os.Getenv("BOOTSTRAP_USERNAME"))
	password := os.Getenv("BOOTSTRAP_PASSWORD")
	if username == "" || password == "" {
		log.Fatal("BOOTSTRAP_USERNAME and BOOTSTRAP_PASSWORD are required")
	}

	role := strings.TrimSpace(os.Getenv("BOOTSTRAP_ROLE"))
	if role == "" {
		role = "SUPERADMIN"
	}
	if _, ok := allowedRoles[role]; !ok {
		log.Fatalf("BOOTSTRAP_ROLE must be one of: SUPERADMIN, ADMIN, SUBADMIN, OPERATOR, COURIER (got %q)", role)
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		log.Fatalf("bcrypt: %v", err)
	}
	hashStr := string(hash)

	pool, err := db.Connect(ctx, dbURL)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()

	var exists bool
	err = pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE username = $1)`, username).Scan(&exists)
	if err != nil {
		log.Fatalf("query: %v", err)
	}

	if exists {
		_, err = pool.Exec(ctx, `
			UPDATE users
			SET password_hash = $1,
			    role = $2,
			    active = true,
			    failed_login_attempts = 0,
			    locked_until = NULL,
			    updated_at = now()
			WHERE username = $3`,
			hashStr, role, username,
		)
		if err != nil {
			log.Fatalf("update user: %v", err)
		}
		fmt.Printf("updated user %q (role=%s)\n", username, role)
		return
	}

	var id string
	err = pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, role, pin_hash)
		VALUES ($1, $2, $3, NULL)
		RETURNING id::text`,
		username, hashStr, role,
	).Scan(&id)
	if err != nil {
		log.Fatalf("insert user: %v", err)
	}
	fmt.Printf("created user %q id=%s role=%s\n", username, id, role)
}
