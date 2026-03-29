# Despliegue en Railway (API Go + front)

Documento único para operar **API** y **front** en Railway. No duplicar este checklist en otros archivos; enlazar desde el README.

El archivo **`railway.json` en la raíz del monorepo** aplica al **servicio del API** (`dockerfilePath: backend/Dockerfile`, contexto raíz). El **servicio del front** debe configurarse aparte (Root Directory `frontend`, ver §6) y **no** depende de ese `railway.json` de la raíz.

## 1. Requisitos en Railway

- Proyecto con **PostgreSQL** (plugin) y servicio que ejecuta la imagen construida desde este repo.
- Repositorio conectado; el build usa **`railway.json`** → builder **DOCKERFILE**, `dockerfilePath: backend/Dockerfile`.
- El **contexto de Docker** es la **raíz del monorepo** (no solo `backend/`). El Dockerfile ya copia `backend/go.mod`, `backend/go.sum` y `backend/`.

## 2. Variables de entorno del servicio API

| Variable        | Obligatorio | Notas |
|----------------|-------------|--------|
| `DATABASE_URL` | Sí          | URL que provee Railway al vincular el plugin Postgres al servicio, o copiada desde la base. Sin esto el proceso termina en `log.Fatalf` al conectar y **no escucha** (el healthcheck falla). |
| `JWT_SECRET`   | Sí (prod)   | Valor aleatorio fuerte. No usar `dev-secret-change-me`. Si `RAILWAY_ENVIRONMENT=production` (u otras reglas abajo), el API **no arranca** sin un secreto distinto al default de desarrollo. |
| `PORT`         | Suele inyectarlo Railway | El API usa `PORT` (ver `backend/internal/config`). |
| `CORS_ALLOWED_ORIGINS` | Recomendado si el front está en otro origen | Lista separada por comas de orígenes exactos (ej. `https://tu-front.up.railway.app`). Sin esto en local, el API solo acepta orígenes de desarrollo (`http://localhost:5173`, `5174`, `3000` y `127.0.0.1` con esos puertos). Si definís la lista pero el entorno **no** es producción endurecida (misma señal que `JWT_SECRET` fuerte obligatorio), el API **también** acepta esos orígenes de Vite, para poder desarrollar en localhost con un `.env` que ya incluya la URL del front en Railway. En Railway producción, solo aplican los orígenes explícitos. |
| `REQUIRE_JWT_SECRET` | No | Si es `1` / `true` / `yes`, obliga a `JWT_SECRET` fuerte aunque no sea prod (útil para staging). |
| `FINA_ENV` / `APP_ENV` | No | Si alguno es `production` (sin distinguir mayúsculas), aplica la misma exigencia de `JWT_SECRET` que en Railway prod. |

No commitear secretos; configurar solo en el panel de Railway.

## 3. Migraciones

1. La base Postgres del entorno debe existir y ser alcanzable desde el API.
2. **En producción (imagen Docker):** al arrancar, el binario **`fina-api` ejecuta `migrate up` automáticamente** usando los `.sql` empaquetados en `/app/migrations` (`MIGRATIONS_PATH`). Un deploy nuevo debería alinear el esquema sin pasos manuales. Si falla una migración, el proceso sale con error y Railway no deja el servicio “sano” hasta corregir la DB o el SQL.
3. **Variable opcional:** `SKIP_DB_MIGRATE=true` desactiva ese paso (solo para depuración o entornos especiales).
4. **Migración manual** desde tu Mac sigue siendo válida y útil para operar sin redeploy:

### Desde tu Mac (manual, sin redeploy)

1. Instalar [golang-migrate](https://github.com/golang-migrate/migrate): `brew install golang-migrate` (macOS).
2. En Railway: **Postgres** → **Variables** → copiar el valor de **`DATABASE_URL`** (o la URL que use tu servicio API). **No** pegues esa URL en el repositorio ni en chats públicos.
3. En la terminal, desde la **raíz del repo**:

```bash
export DATABASE_URL='pegar-aquí-solo-en-tu-terminal'
./scripts/migrate-up.sh
```

Equivalente manual:

```bash
migrate -path backend/migrations -database "$DATABASE_URL" up
```

### Revertir una migración (solo si sabés qué hacés)

```bash
export DATABASE_URL='...'
./scripts/migrate-down.sh
```

(Pide confirmación; aplica `down 1`.)

**Pre-deploy en Railway:** con **auto-migrate al arranque**, un deploy del API suele alinear la base solo; la migración manual sigue sirviendo si `SKIP_DB_MIGRATE` está activo o para corregir sin redeploy.

**Síntoma `DB_SCHEMA_MISMATCH` / Postgres `42703`:** esquema viejo vs código nuevo. Con auto-migrate: **redeploy del API** (imagen nueva). Si usás `SKIP_DB_MIGRATE=true`, ejecutá `migrate up` manual contra esa `DATABASE_URL`.

### 3.1 Usuario de login en producción (bootstrap desde tu Mac)

Las migraciones **no** insertan usuarios. La base local y la de Railway son **independientes**: cambiar contraseña en local **no** actualiza producción.

Para crear o actualizar un usuario (bcrypt igual que el API) **desde tu computadora**, contra la misma Postgres que uses en prod:

1. En Railway → **Postgres** → Variables: para conectar **desde fuera** de Railway usá **`DATABASE_PUBLIC_URL`** (host público tipo `*.rlwy.net`). La URL con `postgres.railway.internal` solo sirve **entre servicios dentro de Railway**.
2. En la terminal (no pegar la URL en chats):

```bash
cd backend
export DATABASE_URL='pegar DATABASE_PUBLIC_URL aquí'
export BOOTSTRAP_USERNAME='tu_usuario'
export BOOTSTRAP_PASSWORD='tu_contraseña'
export BOOTSTRAP_ROLE='SUPERADMIN'   # opcional; default SUPERADMIN
export BOOTSTRAP_CONFIRM='yes'
go run ./cmd/upsert-login-user
```

Si el usuario ya existe, se actualiza `password_hash`, rol, activo y se limpian bloqueos / intentos fallidos. Si no existe, se inserta. Requiere `BOOTSTRAP_CONFIRM=yes` para evitar ejecuciones accidentales.

## 4. Docker y build

- Raíz del repo: `docker build -f backend/Dockerfile .`
- `.dockerignore` en la raíz reduce contexto (node_modules, .env, etc.).

## 5. Healthcheck falla (`/health`)

El endpoint `GET /health` es público y responde JSON `{"status":"ok"}` **solo si el servidor HTTP ya está escuchando**.

En `backend/cmd/api/main.go` la conexión a la base ocurre **antes** de `ListenAndServe`. Si la DB no conecta, el proceso **no llega a abrir el puerto** → el healthcheck devuelve *service unavailable*.

**Qué revisar primero:** **Deploy logs** (no solo Build logs). Buscar `failed to connect to database`. Corregir `DATABASE_URL` o disponibilidad de Postgres.

## 6. Frontend en producción (Vite + segundo servicio Railway)

Vite incrusta `VITE_*` solo en **`npm run build`**. Si el build no ve `VITE_API_BASE`, el cliente cae en el fallback `'/api'` (relativo) y el navegador pide al **mismo origen que el SPA** → el servidor estático devuelve `index.html` (HTML) en lugar del JSON del API.

**Por qué Dockerfile en `frontend/` (decisión):** build reproducible en CI/Railway y garantía de que `ARG`/`ENV` existen **antes** de `npm run build`, que es cuando Vite fija la URL del API en el bundle.

### 6.1 Servicio del front en Railway (panel)

1. **Segundo servicio** en el mismo proyecto (no reutilizar el del API).
2. **Root Directory:** `frontend` (obligatorio). Así el contexto de Docker es solo `frontend/` y se usa `frontend/Dockerfile` + `frontend/railway.json`, no el `railway.json` de la raíz (backend).
3. **Builder:** Dockerfile. Si el panel ofrece Railpack/Nixpacks por defecto, elegir **Dockerfile** explícitamente. Path relativo al Root Directory: `Dockerfile`.
4. **Variables:** `VITE_API_BASE` = URL absoluta del API público que **termina en `/api`**, **sin barra final** (ej. `https://<tu-servicio-api>.up.railway.app/api`). Railway expone las variables del servicio al build de Docker; deben estar definidas **antes** del build para que el `ARG`/`ENV` del Dockerfile llegue a Vite.
5. **Puerto:** la imagen usa `serve` escuchando en `0.0.0.0:${PORT}` (Railway inyecta `PORT`).
6. **Redeploy:** tras cambiar la variable o el código, redeploy; si hay opción de **limpiar caché de build**, usarla cuando el bundle siga viejo.

**Confirmación en el repo:** la rama/commit conectado al servicio del front debe incluir `frontend/Dockerfile`; si no, el build fallará hasta merge/deploy del commit correcto.

### 6.2 Build local (sin Docker)

```bash
cd frontend
VITE_API_BASE=https://<tu-api-publico>/api npm run build
```

Sustituí la URL por la de tu servicio API. El artefacto queda en `frontend/dist/`.

Ver `frontend/.env.example` y `frontend/src/api/client.ts`.

### 6.3 Validación manual (Network)

- Pestaña **Network:** las peticiones van al **dominio del API**, no al del front.
- Respuesta de login (u otro endpoint): **`Content-Type: application/json`**, no `text/html` del `index.html`.
- Tras un deploy correcto, `index.html` referencia un **`index-*.js` con hash nuevo**.

### 6.4 Prompt para el asistente / soporte Railway

Texto listo para copiar: **`docs/railway-frontend-prompt.md`**.

## 7. CORS

El middleware en `backend/internal/http/cors.go` refleja `Access-Control-Allow-Origin` con el header `Origin` de la petición y permite credenciales. Si el navegador bloquea peticiones, comprobar origen, HTTPS y que el front apunte al API correcto (`VITE_API_BASE`).

## 8. Alcance y reglas de oro

Las tareas de **despliegue e infraestructura** no deben mezclar cambios de lógica de negocio, cuentas reales vs CC vs pendientes, ni auditoría, salvo pedido explícito y separado. Cambios mínimos; decisiones críticas documentadas aquí o en el PR.

## 9. Verificación local del código

Tras cambios en backend / frontend:

```bash
cd backend && go test ./...
cd frontend && npm run build
```
