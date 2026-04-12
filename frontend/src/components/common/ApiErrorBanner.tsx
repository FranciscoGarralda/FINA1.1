/** Aviso de error de API / red, mismo estilo que acciones en Movimientos. */
export default function ApiErrorBanner({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="api-error-banner" role="alert">
      {message}
    </div>
  );
}
