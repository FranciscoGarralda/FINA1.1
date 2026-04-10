import { useEffect, useMemo, useState } from 'react';
import MoneyInput from '../common/MoneyInput';
import { formatMoneyAR, numberToNormalizedMoney } from '../../utils/money';

type CalcMode = 'MULTIPLY' | 'DIVIDE' | 'PERCENTAGE';

interface Props {
  onApply: (normalizedAmount: string) => void;
}

export default function OperationAmountCalculator({ onApply }: Props) {
  const [leftOperand, setLeftOperand] = useState('');
  const [rightOperand, setRightOperand] = useState('');
  const [mode, setMode] = useState<CalcMode>('MULTIPLY');
  const [showAppliedFeedback, setShowAppliedFeedback] = useState(false);

  const calculation = useMemo(() => {
    const a = parseFloat(leftOperand);
    const b = parseFloat(rightOperand);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return { valid: false, value: 0, reason: 'Completá ambos valores.' };
    }
    if (mode === 'DIVIDE' && b === 0) {
      return { valid: false, value: 0, reason: 'No se puede dividir por 0.' };
    }
    let value = 0;
    if (mode === 'DIVIDE') {
      value = a / b;
    } else if (mode === 'PERCENTAGE') {
      value = a + (a * b / 100);
    } else {
      value = a * b;
    }
    if (!Number.isFinite(value)) {
      return { valid: false, value: 0, reason: 'Resultado inválido.' };
    }
    return { valid: true, value, reason: '' };
  }, [leftOperand, rightOperand, mode]);

  useEffect(() => {
    if (!showAppliedFeedback) return;
    const timeoutId = window.setTimeout(() => setShowAppliedFeedback(false), 1800);
    return () => window.clearTimeout(timeoutId);
  }, [showAppliedFeedback]);

  return (
    <div className="mt-2 rounded-md border border-subtle bg-surface p-3">
      <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2 min-w-0">
        <p className="text-xs font-semibold text-fg-muted">Calculadora rápida</p>
        <span className="text-[11px] text-fg-muted shrink-0">Solo aplica al campo Monto</span>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)_minmax(0,1fr)_170px]">
        <MoneyInput label="Operando A" value={leftOperand} onValueChange={setLeftOperand} fractionDigits={8} />

        <div>
          <label htmlFor="amount-calc-operation" className="mb-0.5 block text-xs text-fg-muted">Operación</label>
          <select
            id="amount-calc-operation"
            value={mode}
            onChange={(e) => setMode(e.target.value as CalcMode)}
            className="w-full rounded border border-subtle px-2 py-1.5 text-sm"
            aria-label="Seleccionar operación"
          >
            <option value="MULTIPLY">Multiplicar</option>
            <option value="DIVIDE">Dividir</option>
            <option value="PERCENTAGE">Porcentaje</option>
          </select>
        </div>

        <MoneyInput label="Operando B" value={rightOperand} onValueChange={setRightOperand} fractionDigits={8} />

        <div>
          <label className="mb-0.5 block text-xs text-fg-muted">Resultado</label>
          <div className={`min-h-[36px] rounded border px-2 py-1.5 text-sm ${
            calculation.valid ? 'border-subtle bg-elevated text-fg' : 'border-error/40 bg-error-soft text-error'
          }`}>
            {calculation.valid ? formatMoneyAR(calculation.value, 8) : calculation.reason}
          </div>
        </div>

        <div className="flex items-end">
          <button
            type="button"
            disabled={!calculation.valid}
            onClick={() => {
              onApply(numberToNormalizedMoney(calculation.value, 2));
              setShowAppliedFeedback(true);
            }}
            className="w-full rounded border border-subtle bg-brand-soft px-3 py-1.5 text-sm text-brand transition hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-50"
            title="Aplica el resultado al campo Monto"
          >
            Aplicar a monto
          </button>
        </div>
      </div>

      <div className="mt-2 min-h-[18px]">
        {showAppliedFeedback && <p className="text-xs text-success">Monto actualizado.</p>}
      </div>
    </div>
  );
}
