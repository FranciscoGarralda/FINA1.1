import { useState, useEffect, useRef } from 'react';
import { normalizeMoneyInput, formatMoneyAR } from '../../utils/money';

interface Props {
  label?: string;
  value: string;
  onValueChange: (normalized: string) => void;
  fractionDigits?: number;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export default function MoneyInput({
  label,
  value,
  onValueChange,
  fractionDigits = 2,
  placeholder,
  disabled,
  className = '',
}: Props) {
  const [display, setDisplay] = useState('');
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current && value) {
      setDisplay(formatMoneyAR(value, fractionDigits));
    } else if (!value) {
      setDisplay('');
    }
  }, [value, fractionDigits]);

  function handleChange(raw: string) {
    setDisplay(raw);
    const normalized = normalizeMoneyInput(raw);
    onValueChange(normalized);
  }

  function handleBlur() {
    focused.current = false;
    if (!display) return;
    const normalized = normalizeMoneyInput(display);
    const num = parseFloat(normalized);
    if (!isNaN(num)) {
      setDisplay(formatMoneyAR(num, fractionDigits));
    }
  }

  function handleFocus() {
    focused.current = true;
  }

  return (
    <div>
      {label && <label className="block text-xs text-fg-muted mb-0.5">{label}</label>}
      <input
        type="text"
        inputMode="decimal"
        value={display}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        onFocus={handleFocus}
        placeholder={placeholder}
        disabled={disabled}
        className={`input-field font-mono text-right max-w-full ${disabled ? 'opacity-60' : ''} ${className}`.trim()}
      />
    </div>
  );
}
