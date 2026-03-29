# Prompt: servicio del front en Railway

**Fuente de verdad (VITE, CORS, Dockerfile, migraciones, Postgres):** [deploy-railway.md](deploy-railway.md). Este archivo solo añade texto copiable para el panel de Railway.

**Checklist operativo y explicación:** **[deploy-railway.md](deploy-railway.md)** (sección *6. Frontend en producción*).

Debajo: texto para copiar y pegar en el asistente de Railway o soporte (sin secretos; placeholders según tu panel).

---

Proyecto: monorepo FINA1.1 (API Go + front Vite en carpeta `frontend/`). Problema: en el navegador las peticiones van al mismo dominio del front (ej. `/api` relativo) y la respuesta es HTML del SPA (`serve -s`) en lugar de JSON del API, porque Vite incrusta `VITE_API_BASE` solo en tiempo de BUILD.

Necesito configuración correcta del **SERVICIO DEL FRONT** en Railway (no el del API). Guíame paso a paso en el panel:

1) Repo y rama: confirmar qué rama/commit está conectado a ESTE servicio y que incluye `frontend/Dockerfile` + `frontend/railway.json` si aplica. Si la rama desplegada aún no tiene esos archivos, el build con Dockerfile fallará hasta merge/deploy del commit correcto — indicá cómo verificarlo en el panel.

2) Root Directory: exactamente la carpeta del front (p. ej. `frontend`) para no usar el `railway.json` de la raíz del monorepo (backend).

3) Builder: Dockerfile. Path relativo al Root Directory: `Dockerfile`. Si aparece Railpack / auto-detect, cómo forzar Dockerfile para ESTE servicio.

4) Variable **`VITE_API_BASE`**: URL absoluta del API público que **termina en `/api`**, sin barra final extra. Confirmar si Railway la pasa al `docker build` antes de `npm run build` (ARG/ENV en Dockerfile).

5) Puerto: contenedor escuchando en `$PORT` (`serve` + `${PORT}`).

6) Redeploy y, si existe, limpiar caché de build.

Criterios de éxito: Network → llamadas al dominio del API; `Content-Type: application/json`; `index.html` con bundle JS hasheado nuevo.

No pedir secretos en el chat; solo nombres de variables y dónde clickear. Si falta un dato del proyecto, decime qué copiar del panel.
