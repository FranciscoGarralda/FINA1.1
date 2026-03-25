# Reseteo operativo (clientes + operaciones + CC + pendientes + arqueos + auditoría)

## Qué borra

El archivo `reset-operational-data.sql` elimina datos de:

- Movimientos (cabecera, líneas, borradores, correcciones), pendientes, CC (balances, entradas, ajustes manuales), arqueos de caja, clientes, `audit_logs`.

## Qué no borra

Usuarios, divisas, cuentas (y `account_currencies`), `system_settings`, catálogo de permisos y overrides por usuario.

## Antes de ejecutar

1. **Backup** o snapshot del Postgres (obligatorio en producción).
2. Copiá la URL de conexión desde Railway → Postgres → Variables (`DATABASE_URL` o `DATABASE_PUBLIC_URL` si conectás desde fuera). **No la subas al repo ni la pegues en chats.**

## Comando

Desde la **raíz del monorepo**:

```bash
export DATABASE_URL='(solo en tu terminal)'
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/reset-operational-data.sql
```

Requiere `psql` (p. ej. `brew install libpq` en macOS).

## Prompt para asistente / equipo

```text
Necesito vaciar en la base de datos de Fina (Postgres) todos los clientes, movimientos, líneas, borradores, correcciones de movimiento, pendientes, CC (balances, entradas, ajustes manuales), arqueos de caja y audit_logs, sin tocar usuarios, divisas, cuentas ni settings/permisos. El repo tiene scripts/reset-operational-data.sql; ejecutarlo con psql y DATABASE_URL tras backup. No usar migrate down para borrar datos.
```

## Notas

- No uses `migrate down` para “limpiar datos”: rompe el control de versiones del esquema.
- Si Postgres devuelve error de FK, enviá el mensaje completo; el orden del script sigue el esquema actual del proyecto.
