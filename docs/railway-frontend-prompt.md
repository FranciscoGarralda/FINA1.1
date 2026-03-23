# Prompt: configuración del servicio del front en Railway

Copiar y pegar en el asistente de Railway o soporte. No incluye secretos; reemplazá placeholders por los valores de tu panel.

---

Proyecto: monorepo FINA1.1 (API Go + front Vite en carpeta frontend/). Problema: en el navegador las peticiones van al mismo dominio del front (ej. /api relativo) y la respuesta es HTML del SPA (serve -s) en lugar de JSON del API, porque Vite incrusta VITE_API_BASE solo en tiempo de BUILD.

Necesito configuración correcta del SERVICIO DEL FRONT en Railway (no el del API). Guíame paso a paso en el panel:

1) Repo y rama: confirmar qué rama/commit está conectado a ESTE servicio (ideal-beauty o nombre equivalente) y que incluye frontend/Dockerfile + frontend/railway.json si aplica. Si la rama desplegada aún no tiene esos archivos, el build con Dockerfile fallará hasta merge/deploy del commit correcto — indicá cómo verificarlo en el panel.

2) Root Directory: debe ser exactamente la carpeta del front (p. ej. "frontend") para que el build no use el railway.json de la raíz del monorepo (ese suele ser del backend).

3) Builder: Dockerfile. Path del Dockerfile relativo al Root Directory: "Dockerfile" (archivo frontend/Dockerfile en el repo). Si Railway muestra Railpack / detección automática en lugar de Docker, indicar cómo forzar Dockerfile para ESTE servicio según la UI actual.

4) Variable de entorno del servicio (nombre exacto): VITE_API_BASE = URL absoluta del API público que TERMINA en /api, SIN barra final extra. Ejemplo de forma: https://<TU-SERVICIO-API>.up.railway.app/api
   - Confirmar si Railway pasa esta variable al paso de docker build para que ARG/ENV en Dockerfile llegue antes de `npm run build`. Si no basta como variable normal, indicar la opción correcta (build-time / Docker build args) según la UI actual de Railway.

5) Puerto: el contenedor debe escuchar en $PORT que inyecta Railway (CMD debe usar serve con ${PORT}).

6) Redeploy: indicar cómo forzar redeploy y, si existe, "clear build cache" o equivalente.

Criterios de éxito (verificables):

- En el navegador → pestaña Network: las llamadas a login u otros endpoints van al DOMINIO DEL API (no al del front).
- La respuesta tiene Content-Type JSON (application/json), no text/html del index.html.
- Tras el deploy, el index.html referencia un bundle JS con hash nuevo.

No pedir ni pegar secretos en el chat; solo nombres de variables y dónde clickear en Railway. Si algo depende de mi proyecto (nombre exacto del servicio API), decime qué dato te tengo que pasar desde el panel.
