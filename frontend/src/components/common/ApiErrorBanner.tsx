/** Aviso de error de API / red, mismo estilo que acciones en Movimientos. */
export default function ApiErrorBanner({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div
      className="mb-3 rounded border border-error/40 bg-error-soft px-3 py-2 text-sm text-error"
      role="alert"
    >
      {message}
    </div>
  );
}
