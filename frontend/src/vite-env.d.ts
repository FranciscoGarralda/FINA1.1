/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL absoluta del prefijo /api (sin barra final). Opcional; default `/api` en dev (proxy Vite). */
  readonly VITE_API_BASE?: string;
}
