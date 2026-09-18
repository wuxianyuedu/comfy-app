"use client";

import { useCallback, useState } from "react";
import { Minus, Plus } from "lucide-react";

import { Button } from "~/components/ui/button";

/**
 * ComfyUI 风数值步进器：  [—] [值] [+]
 *
 * 替换浏览器原生 <input type="number">，后者有：
 *   - 深色主题下颜色不对
 *   - 悬停就改值（spinner 按钮太容易误触）
 *   - 没有 min/max 边界的视觉提示
 *
 * 输入用「草稿态」：聚焦期间的击键保存在本地 draft 里原样回显（受控 value 的
 * clamp 回写会在输入中途把 "0." / 清空 / 小于 step 的值瞬间顶回去，等于
 * 没法打字）；blur 或点 +/- 时才把草稿 clamp 成合法值提交。
 */
interface NumberFieldProps {
  /** 当前数值 */
  value: number;
  /** 用新的（已 clamp 的）值调用 */
  onChange: (v: number) => void;
  /** 允许的最小值（默认 0） */
  min?: number;
  /** 允许的最大值（默认 9999） */
  max?: number;
  /** 步进增 / 减量（默认 1） */
  step?: number;
  /** 显示的小数位（默认 0 = 整数） */
  decimalPlaces?: number;
  /** 外层容器的额外 CSS 类 */
  className?: string;
  /** 字段是否禁用 */
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
  const [draft, setDraft] = useState<string | null>(null);

  const fmt = useCallback(
    (v: number) => (decimalPlaces > 0 ? v.toFixed(decimalPlaces) : String(v)),
    [decimalPlaces],
  );

  const clamp = useCallback(
    (v: number) => {
      const rounded = Math.round(v / step) * step;
      return Math.min(max, Math.max(min, rounded));
    },
    [min, max, step],
  );

  const commitText = useCallback(
    (text: string) => {
      const n = parseFloat(text);
      if (!isNaN(n)) onChange(clamp(n));
    },
    [clamp, onChange],
  );

  const decr = useCallback(() => {
    setDraft(null);
    onChange(clamp(value - step));
  }, [value, step, clamp, onChange]);
  const incr = useCallback(() => {
    setDraft(null);
    onChange(clamp(value + step));
  }, [value, step, clamp, onChange]);

  return (
    <div
      className={`nodrag nopan border-border-strong bg-subtle flex items-center gap-0 rounded-lg border transition-opacity ${
        disabled ? "pointer-events-none opacity-40" : ""
      } ${className ?? ""}`}
    >
      <Button
        variant="ghost"
        onMouseDown={(event) => {
          event.preventDefault();
          decr();
        }}
        disabled={disabled || value <= min}
        className="text-ink-muted hover:bg-surface-2 hover:text-ink-bright active:text-ink size-6 shrink-0 rounded-none px-0"
        title={`减少 ${step}`}
      >
        <Minus size={12} strokeWidth={2.5} />
      </Button>
      <input
        type="text"
        inputMode="decimal"
        value={draft ?? fmt(value)}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          /* 合法前缀实时上抛（clamp 只影响提交值，不打断击键回显） */
          const n = parseFloat(text);
          if (!isNaN(n)) onChange(clamp(n));
        }}
        onBlur={() => {
          if (draft !== null) {
            commitText(draft);
            setDraft(null);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            (event.target as HTMLInputElement).blur();
          }
        }}
        disabled={disabled}
        className="text-ink-bright h-[24px] min-w-[36px] flex-1 [appearance:textfield] bg-transparent py-0 text-center font-mono text-xs outline-none disabled:opacity-40 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <Button
        variant="ghost"
        onMouseDown={(event) => {
          event.preventDefault();
          incr();
        }}
        disabled={disabled || value >= max}
        className="text-ink-muted hover:bg-surface-2 hover:text-ink-bright active:text-ink size-6 shrink-0 rounded-none px-0"
        title={`增加 ${step}`}
      >
        <Plus size={12} strokeWidth={2.5} />
      </Button>
    </div>
  );
}

export default NumberField;
