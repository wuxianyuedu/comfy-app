import { useCallback } from "react";

/**
 * ComfyUI-style numeric stepper:  [—] [value] [+]
 *
 * Replaces the browser's native <input type="number"> which has:
 *   - wrong colors in dark theme
 *   - hover-triggered value changes (the spinner buttons are too easy to hit)
 *   - no visual indication of min/max bounds
 */
interface NumberFieldProps {
  /** Current numeric value */
  value: number;
  /** Called with the new (clamped) value */
  onChange: (v: number) => void;
  /** Minimum allowed value (default 0) */
  min?: number;
  /** Maximum allowed value (default 9999) */
  max?: number;
  /** Step increment/decrement amount (default 1) */
  step?: number;
  /** Decimal places to display (default 0 = integer) */
  decimalPlaces?: number;
  /** Additional CSS classes for the outer container */
  className?: string;
  /** Whether the field is disabled */
  disabled?: boolean;
}

export function NumberField({
  value,
  onChange,
  min = 0,
  max = 9999,
  step = 1,
  decimalPlaces = 0,
  className,
  disabled = false,
}: NumberFieldProps) {
  const fmt = useCallback(
    (v: number) => (decimalPlaces > 0 ? v.toFixed(decimalPlaces) : String(v)),
    [decimalPlaces]
  );

  const clamp = useCallback(
    (v: number) => {
      const rounded = Math.round(v / step) * step;
      return Math.min(max, Math.max(min, rounded));
    },
    [min, max, step]
  );

  const decr = useCallback(
    () => onChange(clamp(value - step)),
    [value, step, clamp, onChange]
  );
  const incr = useCallback(
    () => onChange(clamp(value + step)),
    [value, step, clamp, onChange]
  );

  return (
    <div
      className={`nodrag nopan flex items-center gap-0 rounded-lg border border-white/[0.08] bg-white/[0.03] transition-opacity ${
        disabled ? "opacity-40 pointer-events-none" : ""
      } ${className ?? ""}`}
    >
      <button
        type="button"
        onMouseDown={(event) => { event.preventDefault(); decr(); }}
        disabled={disabled || value <= min}
        className="flex h-[24px] w-[24px] shrink-0 items-center justify-center text-gray-500 transition-colors hover:bg-white/[0.06] hover:text-gray-200 active:text-white disabled:opacity-30"
        title={`减少 ${step}`}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M5 12h14" />
        </svg>
      </button>
      <input
        type="text"
        inputMode="decimal"
        value={fmt(value)}
        onChange={(event) => {
          const n = parseFloat(event.target.value);
          if (!isNaN(n)) onChange(clamp(n));
        }}
        onBlur={(event) => {
          // Re-format on blur for consistent display
          const n = parseFloat(event.target.value);
          if (!isNaN(n)) onChange(clamp(n));
          else (event.target).value = fmt(value);
        }}
        disabled={disabled}
        className="min-w-[36px] h-[24px] flex-1 bg-transparent py-0 text-center text-xs font-mono text-gray-200 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none disabled:opacity-40"
      />
      <button
        type="button"
        onMouseDown={(event) => { event.preventDefault(); incr(); }}
        disabled={disabled || value >= max}
        className="flex h-[24px] w-[24px] shrink-0 items-center justify-center text-gray-500 transition-colors hover:bg-white/[0.06] hover:text-gray-200 active:text-white disabled:opacity-30"
        title={`增加 ${step}`}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  );
}

export default NumberField;
