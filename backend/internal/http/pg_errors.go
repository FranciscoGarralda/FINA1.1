package http

import (
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
)

// mapPostgresClientErr traduce errores comunes de Postgres en respuestas HTTP seguras
// para flujos de clientes (alta/edición/listado). Si ok es false, el caller debe usar error genérico.
func mapPostgresClientErr(err error) (status int, apiCode, message string, ok bool) {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return 0, "", "", false
	}
	switch pgErr.Code {
	case "42703": // undefined_column
		return http.StatusInternalServerError, "DB_SCHEMA_MISMATCH",
			"La base de datos no coincide con la versión del código: falta al menos una columna (p. ej. department en clients). Ejecutá las migraciones en este entorno: migrate -path backend/migrations -database \"$DATABASE_URL\" up (ver docs/deploy-railway.md).",
			true
	case "42P01": // undefined_table
		return http.StatusInternalServerError, "DB_SCHEMA_MISMATCH",
			"Falta una tabla esperada en la base de datos. Ejecutá las migraciones pendientes en este entorno (docs/deploy-railway.md).",
			true
	case "23503": // foreign_key_violation
		return http.StatusBadRequest, "REFERENTIAL_INTEGRITY",
			"No se pudo guardar: una referencia no existe en la base (por ejemplo usuario de la sesión o divisa en ajustes de CC).",
			true
	case "22P02": // invalid_text_representation
		if strings.Contains(strings.ToLower(pgErr.Message), "uuid") {
			return http.StatusBadRequest, "INVALID_UUID",
				"Algún identificador no tiene formato UUID válido.",
				true
		}
		return http.StatusBadRequest, "INVALID_VALUE",
			"Un valor enviado no tiene el formato esperado para la base de datos.",
			true
	default:
		return 0, "", "", false
	}
}
