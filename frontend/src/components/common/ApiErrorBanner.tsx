/** Aviso de error de API / red, mismo estilo que acciones en Movimientos. */
export default function ApiErrorBanner({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div
      className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
      role="alert"
    >
      {message}
    </div>
  );
}
