import type { ReactNode } from 'react';

/**
 * Filas de acción unificadas (modal, formulario inline, celdas de tabla).
 *
 * ## LTR (es-AR, UI en orden de lectura izquierda → derecha)
 *
 * - **modal / inline (desktop sm+):** grupo “neutral / secundario” a la **izquierda**;
 *   la acción **primaria** (Guardar) a la **derecha**. En el grupo izquierdo, en fila:
 *   **Cancelar** primero, luego secundarias y peligro (`sm:order` para lograrlo sin duplicar DOM).
 * - **Móvil (< sm):** columna con **misma anchura efectiva** para botones apilados (`w-full` en botones).
 *   Orden vertical **fijo**: **primario arriba** → secundarias / peligro → **Cancelar abajo**.
 *
 * ## Un solo botón en el bloque
 *
 * Si solo hay primario, solo cancelar o un único hijo, el contenedor **colapsa** (sin `justify-between` fantasma).
 *
 * ## type="submit" vs type="button"
 *
 * En un `<form>` con varias acciones, debe haber **como mucho un** `type="submit"` (envío explícito);
 * el resto `type="button"` para no disparar envío con Enter accidental. Este componente no fija `type`;
 * lo define cada consumidor.
 *
 * Solo presentación; sin reglas de negocio (reglas de oro Fina).
 */
export type FormActionsRowVariant = 'modal' | 'inline' | 'table';

const btnStrip =
  '[&_button]:w-full [&_button]:min-w-0 [&_button]:text-center [&_button]:break-words sm:[&_button]:w-auto';

type ModalProps = {
  variant: 'modal';
  className?: string;
  /** Acción principal (Guardar, Guardar permisos, …). Desktop: derecha; móvil: arriba. */
  primary?: ReactNode;
  /** Secundarias (p. ej. Restaurar). */
  secondary?: ReactNode;
  danger?: ReactNode;
  cancel?: ReactNode;
};

type InlineOrTableProps = {
  variant: 'inline' | 'table';
  className?: string;
  children: ReactNode;
};

export type FormActionsRowProps = ModalProps | InlineOrTableProps;

function isPresent(node: ReactNode): boolean {
  if (node == null || node === false) return false;
  return true;
}

export default function FormActionsRow(props: FormActionsRowProps) {
  if (props.variant === 'inline') {
    const merged = ['form-actions', props.className].filter(Boolean).join(' ');
    return <div className={merged}>{props.children}</div>;
  }

  if (props.variant === 'table') {
    const merged = [
      'flex w-full min-w-0 flex-col gap-1.5 sm:max-w-xs sm:flex-row sm:items-stretch sm:gap-2',
      '[&_button]:min-w-0 [&_button]:text-center [&_button]:break-words',
      props.className,
    ]
      .filter(Boolean)
      .join(' ');
    return <div className={merged}>{props.children}</div>;
  }

  const { primary, secondary, danger, cancel, className = '' } = props as ModalProps;

  const hasPrimary = isPresent(primary);
  const hasSecondary = isPresent(secondary);
  const hasDanger = isPresent(danger);
  const hasCancel = isPresent(cancel);
  const hasLeft = hasSecondary || hasDanger || hasCancel;

  if (!hasPrimary && !hasLeft) {
    return null;
  }

  if (!hasPrimary && hasLeft) {
    return (
      <div
        className={[
          'flex w-full min-w-0 flex-col gap-2 pt-2 sm:flex-row sm:flex-wrap sm:gap-2 sm:items-center',
          btnStrip,
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {hasSecondary && (
          <div className="w-full min-w-0 sm:w-auto sm:order-2">{secondary}</div>
        )}
        {hasDanger && <div className="w-full min-w-0 sm:w-auto sm:order-3">{danger}</div>}
        {hasCancel && <div className="w-full min-w-0 sm:w-auto sm:order-1">{cancel}</div>}
      </div>
    );
  }

  if (hasPrimary && !hasLeft) {
    return (
      <div className={['flex w-full min-w-0 flex-col gap-2 pt-2', btnStrip, className].filter(Boolean).join(' ')}>
        {primary}
      </div>
    );
  }

  return (
    <div
      className={[
        'flex w-full min-w-0 flex-col gap-2 pt-2 sm:flex-row sm:justify-between sm:items-stretch sm:gap-3',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className={['order-1 flex w-full min-w-0 flex-col gap-2 sm:order-2 sm:w-auto sm:shrink-0 sm:items-end', btnStrip].join(' ')}>
        {primary}
      </div>
      <div
        className={[
          'order-2 flex w-full min-w-0 flex-col gap-2 sm:order-1 sm:flex-1 sm:flex-row sm:flex-wrap sm:gap-2 sm:content-center sm:min-w-0',
          btnStrip,
        ].join(' ')}
      >
        {hasSecondary && (
          <div className="w-full min-w-0 sm:w-auto sm:order-2">{secondary}</div>
        )}
        {hasDanger && <div className="w-full min-w-0 sm:w-auto sm:order-3">{danger}</div>}
        {hasCancel && <div className="w-full min-w-0 sm:w-auto sm:order-1">{cancel}</div>}
      </div>
    </div>
  );
}
