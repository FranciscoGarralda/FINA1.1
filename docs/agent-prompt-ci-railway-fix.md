# Prompt: Arreglar CI (GitHub) + coherencia Docker/Railway (Fina 1.1)

Usar con modo Agent. Alineado con **Reglas de Oro** del proyecto (`.cursor/rules/reglas-de-oro-operativas.mdc`), en particular **11–16** y **17–20** (toolchain, secretos, CI, despliegue).

## Contexto

- GitHub Actions (`.github/workflows/ci.yml`) ejecuta `govulncheck` y falla con exit code 3: vulnerabilidades en **stdlib** asociadas a **Go 1.24.0** (u otra patch obsoleta).
- Railway construye con `backend/Dockerfile` (`golang:1.24-alpine`); el healthcheck falla si el proceso **no escucha**. Logs típicos: **`JWT_SECRET`** obligatorio en producción (rechazo de `dev-secret-change-me`).

**Nota operativa:** el fallo de **JWT** en Railway **no se corrige con código** en este prompt; solo con variables en el panel (`JWT_SECRET` fuerte, `DATABASE_URL` correcta). Documentado en `docs/deploy-railway.md`.

## Objetivos

1. **CI verde:** `govulncheck ./...` sin fallo por stdlib obsoleto (subir patch de Go hasta cumplir o documentar excepción explícita; no silenciar el job sin decisión).
2. **Toolchain unificada (regla 17):** misma familia/patch de Go en `backend/go.mod`, `backend/Dockerfile` (stage build) y CI (`setup-go` vía `go-version-file` o versión explícita).
3. **Documentación:** revisar `docs/deploy-railway.md`; actualizar **README** si menciona versión mínima de Go (p. ej. alinear con la elegida).

## Tareas técnicas (orden)

1. Elegir versión Go parcheada (preferir **última 1.24.x** estable; si `govulncheck` sigue marcando CVEs del stdlib solo corregidas en **1.25.8+** —p. ej. GO-2026-4602/4601—, subir a **1.25.8** y alinear Dockerfile + `go.mod`).
2. Editar `backend/go.mod`: línea `go X.Y.Z`. Opcional: `toolchain goX.Y.Z` si mejora reproducibilidad local/CI.
3. En `backend`: `go mod tidy` si aplica.
4. Editar `backend/Dockerfile`: `FROM golang:X.Y.Z-alpine` coherente con `go.mod`.
5. Verificar `.github/workflows/ci.yml`: `go-version-file: backend/go.mod` o fijar `go-version` explícita si hay ambigüedad.
6. Re-ejecutar `govulncheck`; si aún falla, subir patch dentro de la misma línea mayor hasta pasar.
7. Local / evidencia (reglas 14–15): `cd backend && go vet ./... && go test ./... && go build ./cmd/api`; instalar y correr `govulncheck ./...`. Si se tocara front compartido: `npm run build` en `frontend`.
8. Commit con mensaje que **explique brevemente la elección de versión de Go** (regla 15).
9. Push; verificar GitHub Actions.

## Fuera de alcance del agente (operación humana — reglas 16, 18, 20)

- Definir **`JWT_SECRET`** fuerte en Railway (no commitear).
- Confirmar **`DATABASE_URL`** y redeploy del servicio API.
- Checklist explícito si queda riesgo residual operativo hasta que prod esté sano.

## Criterios de aceptación

- Workflow CI: todos los steps en verde, incluido `govulncheck`.
- Dockerfile sigue construyendo `fina-api`; CMD, `PORT`, `MIGRATIONS_PATH` y healthcheck sin cambios innecesarios.
- README y `docs/deploy-railway.md` coherentes con la versión de Go y con JWT/DB en prod.

## Reglas de oro (resumen para esta tarea)

- **11–13:** sin romper API; cambios mínimos; alcance estricto (toolchain + CI + Docker + doc).
- **14–16:** evidencia de cierre, trazabilidad en el commit, riesgo residual cero (incl. ops en Railway).
- **17:** Go alineado en go.mod, Dockerfile, CI; doc/README actualizados.
- **18:** ningún secreto en el repo.
- **19:** no cerrar con CI rojo sin decisión documentada.
- **20:** no debilitar políticas de JWT en código para “salvar” un deploy mal configurado.
