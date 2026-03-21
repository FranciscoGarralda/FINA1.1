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
    <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-gray-600">Calculadora rápida</p>
        <span className="text-[11px] text-gray-500">Solo aplica al campo Monto</span>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)_minmax(0,1fr)_170px]">
        <MoneyInput label="Operando A" value={leftOperand} onValueChange={setLeftOperand} fractionDigits={8} />

        <div>
          <label htmlFor="amount-calc-operation" className="mb-0.5 block text-xs text-gray-500">Operación</label>
          <select
            id="amount-calc-operation"
            value={mode}
            onChange={(e) => setMode(e.target.value as CalcMode)}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            aria-label="Seleccionar operación"
          >
            <option value="MULTIPLY">Multiplicar</option>
            <option value="DIVIDE">Dividir</option>
            <option value="PERCENTAGE">Porcentaje</option>
          </select>
        </div>

        <MoneyInput label="Operando B" value={rightOperand} onValueChange={setRightOperand} fractionDigits={8} />

        <div>
          <label className="mb-0.5 block text-xs text-gray-500">Resultado</label>
          <div className={`min-h-[36px] rounded border px-2 py-1.5 text-sm ${
            calculation.valid ? 'border-gray-200 bg-white text-gray-800' : 'border-red-200 bg-red-50 text-red-700'
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
            className="w-full rounded border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
            title="Aplica el resultado al campo Monto"
          >
            Aplicar a monto
          </button>
        </div>
      </div>

      <div className="mt-2 min-h-[18px]">
        {showAppliedFeedback && <p className="text-xs text-green-700">Monto actualizado.</p>}
      </div>
    </div>
  );
}
