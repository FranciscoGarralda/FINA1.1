/**
 * Barra estándar: Guardar → Guardar borrador → Limpiar → Cancelar.
 * Usa .form-actions + .btn-touch de index.css (responsive, altura táctil).
 */
export interface OperationFormActionsProps {
  onSubmit: () => void;
  onSaveDraft: () => void;
  onClear: () => void;
  onCancel: () => void;
  submitting: boolean;
  savingDraft: boolean;
  draftLoading: boolean;
  /** Espaciado / utilidades del contenedor tras `form-actions` (default `pt-4`). */
  className?: string;
}

export default function OperationFormActions({
  onSubmit,
  onSaveDraft,
  onClear,
  onCancel,
  submitting,
  savingDraft,
  draftLoading,
  className = 'pt-4',
}: OperationFormActionsProps) {
  const blockMain = submitting || savingDraft || draftLoading;
  const blockClear = submitting || savingDraft;

  const wrap = ['form-actions', className].filter(Boolean).join(' ');

  return (
    <div className={wrap}>
      <button
        type="button"
        onClick={onSubmit}
        disabled={blockMain}
        className="btn-touch rounded-md bg-blue-600 font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition"
      >
        {submitting ? 'Guardando...' : 'Guardar'}
      </button>
      <button
        type="button"
        onClick={onSaveDraft}
        disabled={blockMain}
        className="btn-touch rounded-md border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-50 transition"
      >
        {savingDraft ? 'Guardando borrador...' : 'Guardar borrador'}
      </button>
      <button
        type="button"
        onClick={onClear}
        disabled={blockClear}
        className="btn-touch rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition"
      >
        Limpiar
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="btn-touch rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 transition"
      >
        Cancelar
      </button>
    </div>
  );
}
