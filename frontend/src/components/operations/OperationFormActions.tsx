import FormActionsRow from '../common/FormActionsRow';

/**
 * Barra estándar: Guardar → Guardar borrador → Limpiar → Cancelar.
 * Layout unificado vía FormActionsRow (inline) + .form-actions + .btn-touch en index.css.
 * Todas las acciones son type="button" para no enviar el form con Enter; el padre debe manejar submit si aplica.
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

  return (
    <FormActionsRow variant="inline" className={className}>
      <button
        type="button"
        onClick={onSubmit}
        disabled={blockMain}
        className="btn-touch rounded-md bg-brand font-medium text-white hover:bg-brand-hover disabled:opacity-50 transition"
      >
        {submitting ? 'Guardando...' : 'Guardar'}
      </button>
      <button
        type="button"
        onClick={onSaveDraft}
        disabled={blockMain}
        className="btn-touch rounded-md border border-subtle text-brand hover:bg-brand-soft disabled:opacity-50 transition"
      >
        {savingDraft ? 'Guardando borrador...' : 'Guardar borrador'}
      </button>
      <button
        type="button"
        onClick={onClear}
        disabled={blockClear}
        className="btn-touch rounded-md border border-subtle text-fg-muted hover:bg-surface disabled:opacity-50 transition"
      >
        Limpiar
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="btn-touch rounded-md border border-subtle text-fg-muted hover:bg-surface transition"
      >
        Cancelar
      </button>
    </FormActionsRow>
  );
}
