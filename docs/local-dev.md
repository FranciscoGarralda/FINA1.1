# Desarrollo local (Postgres, scripts, migraciones)

Documento canónico para arranque local, logs y recuperación ante errores habituales. La guía de Railway sigue en **[deploy-railway.md](deploy-railway.md)**.

## Problemas comunes (local)

### `docker` no está en el PATH / Docker Desktop apagado

Los scripts `scripts/start-local.sh` y `scripts/run-local-dev.sh` comprueban `command -v docker`. Si falla, abrí **Docker Desktop** y esperá a que termine de arrancar; volvé a ejecutar el script.

### `Permission denied` al correr `./scripts/...`

Los `.sh` deben ser ejecutables. Desde la raíz del repo:

```bash
chmod +x scripts/*.sh
```

(o al menos `scripts/start-local.sh` y `scripts/run-local-dev.sh` si solo usás esos).

### `DATABASE_URL` en `.env`: Postgres local vs nube (Supabase / Railway)

Si **`backend/.env`** o **`.env`** en la raíz define **`DATABASE_URL`**, el API usa **esa** base (nube u otra instancia), no el Postgres de `docker compose`. Así podés desarrollar en Cursor con API local y datos en Supabase.

Sin `DATABASE_URL`, el default es **`fina:fina@localhost:5432/fina`** (requiere `docker compose up -d`).

Plantilla: **`backend/.env.example`**.

### `listen tcp :8080: bind: address already in use`

El puerto **8080** está ocupado (suele ser otro `go run ./cmd/api`).

**macOS / Linux:**

```bash
lsof -i :8080
kill <PID>
```

O usá otro puerto y alineá el proxy de Vite (`frontend/vite.config.ts` → `target`) con ese puerto:

```bash
PORT=8081 go run ./cmd/api
```

### El API no responde en `/health`

- Con **`run-local-dev.sh`**: el script escribe el API en **`/tmp/fina-local-api.log`**. Revisá ahí el error (conexión a Postgres, migraciones, puerto ocupado, etc.).
- Con **`start-local.sh`**: las migraciones corren en la misma terminal; errores aparecen en salida estándar antes de que levantes el API a mano.
- Si el mensaje apunta a la base: comprobá `docker compose` en **`127.0.0.1:5432`** (`fina` / `fina` / `fina`) **o** que `DATABASE_URL` apunte a la instancia correcta.

### `Dirty database version N` (golang-migrate)

[golang-migrate](https://github.com/golang-migrate/migrate) guarda el estado en la tabla **`schema_migrations`**: incluye la **versión** actual y un flag **`dirty`**. Si una migración **falla a mitad de camino**, la herramienta puede dejar `dirty = true` y el API (o `migrate up`) dejará de avanzar hasta corregirlo.

**No hay un único comando válido para todos los casos.** El procedimiento seguro es:

1. **Diagnosticar:** conectarte a la misma base que usa el API (local: URL del README; Railway: **`DATABASE_URL`** / **`DATABASE_PUBLIC_URL`** según [deploy-railway.md](deploy-railway.md)) y revisar `schema_migrations` (versión y dirty).
2. **Entender el esquema real:** comparar con el `.sql` de la migración que falló (en `backend/migrations/`).
3. **Decidir:**
   - Si la migración **no aplicó cambios** o los revertiste a mano: suele usarse **`migrate force <versión>`** para alinear el número de versión con la realidad del esquema, y luego **`migrate up`**. La semántica exacta está en la documentación oficial de golang-migrate; **forzar una versión incorrecta deja el esquema y el historial desalineados**.
   - Si la migración **sí dejó objetos creados** y el estado es coherente con “versión N aplicada”: a veces corresponde marcar consistencia con `force` y dirty en falso; si no estás seguro, **backup** y revisá con calma.
4. **Producción / Railway:** mismo cuidado que con cualquier cambio de esquema: **backup**, no pegar URLs en chats públicos, usar la URL que corresponda según [deploy-railway.md](deploy-railway.md).

### Volumen Docker `pgdata` viejo vs esquema nuevo (solo local)

Si podés **perder todos los datos de la base local**, podés recrear el volumen:

```bash
docker compose down -v
docker compose up -d
```

Luego volvé a aplicar migraciones (`./scripts/start-local.sh` hasta el paso de migrate, o `migrate up` manual, o arrancar el API para que ejecute `migrate up`). **`-v` borra el volumen `pgdata`:** usuarios y datos locales desaparecen.

### No uses `migrate down` para “limpiar” datos operativos

`migrate down` revierte **esquema** (una versión a la vez), no sustituye un reset de datos. Para vaciar datos operativos manteniendo usuarios/cuentas/etc., usá el flujo descrito en **[scripts/README-reset-operational-data.md](../scripts/README-reset-operational-data.md)**.
