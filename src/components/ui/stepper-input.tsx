"use client";

/**
 * 悬浮式数字步进输入框：上下箭头悬浮在输入框内部右侧，悬停 / 聚焦时浮现。
 *
 * 为什么不用原生 `<input type="number">`（ISSUE #3495）：Chromium 的原生
 * spinner 自带一块按钮底（浅色主题下是白底压在字段上），箭头还常驻占位。
 * 本件改成 `type="text"` + 自绘箭头：原生 spinner 不再出现，箭头悬在框内、
 * hover / focus-within 时浮现，点击按 `step` 增减并 clamp 进 [min, max]。
 *
 * 与 `NumberField`（`[—] 值 [+]` 步进器）是两种形态：这里保留「一个输入框」
 * 的观感，适合设置页参数行。输入沿用「草稿直显」：击键原样上抛、不做 clamp
 * （受控 clamp 会在输入中途把 `0.` / 空串顶回去）；提交（落库）由调用方在
 * `onCommit` 里做 —— 失焦或点箭头各触发一次。
 */

import { useCallback } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";

import { Input } from "~/components/ui/input";
import { clamp } from "~/lib/clamp";
import { trimmed } from "~/lib/number-format";
import { cn } from "~/lib/utils";
import { Hint } from "~/components/ui/hint";

type StepperInputProps = {
  /** 无外部 label 挂点时的可访问名。 */
  ariaLabel?: string;
  /** 容器额外 class（宽度档给这里，如 `w-24`）。 */
  className?: string;
  disabled?: boolean;
  id?: string;
  /** 传给 Input 的额外 class（底色 / 字号等观感归调用点）。右侧内边距由
   *  本件统一给足（箭头悬浮区），调用点不要再写 `pr-*` / `px-*`。 */
  inputClassName?: string;
  /** 允许的最大值（缺省不设上限）。 */
  max?: number;
  /** 允许的最小值（缺省不设下限）。 */
  min?: number;
  /** 失焦或点箭头后的提交回调（调用方在此落库）。 */
  onCommit?: () => void;
  /** 击键回调：草稿原样上抛，不做 clamp。 */
  onValueChange: (next: string) => void;
  placeholder?: string;
  /** 单击箭头的增 / 减量（默认 1；小数步进按它的小数位收口浮点 drift）。 */
  step?: number;
  /** 当前值（受控字符串）。 */
  value: string;
};

export function StepperInput({
  value,
  onValueChange,
  onCommit,
  min,
  max,
  step = 1,
  id,
  ariaLabel,
  placeholder,
  disabled,
  className,
  inputClassName,
}: StepperInputProps) {
  const decimals = (String(step).split(".")[1] ?? "").length;

  /** 点箭头：按 step 档取整 + 夹进边界，再走一次提交。当前值不是数时从
   *  下限（无下限则 0）起步 —— 与「清空后点 +」的直觉一致。 */
  const bump = useCallback(
    (dir: 1 | -1) => {
      const parsed = Number.parseFloat(value);
      const base = Number.isNaN(parsed) ? (min ?? 0) : parsed;
      const stepped = Math.round((base + dir * step) / step) * step;
      const next = clamp(stepped, min ?? -Infinity, max ?? Infinity);
      onValueChange(trimmed(next, decimals) ?? String(next));
      onCommit?.();
    },
    [value, step, min, max, decimals, onValueChange, onCommit],
  );

  return (
    <div className={cn("group relative inline-flex", className)}>
      <Input
        aria-label={ariaLabel}
        className={cn(
          inputClassName,
          "pr-7 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        )}
        disabled={disabled}
        id={id}
        inputMode="decimal"
        onBlur={onCommit}
        onChange={(event) => {
          onValueChange(event.target.value);
        }}
        placeholder={placeholder}
        type="text"
        value={value}
      />
      <div className="absolute top-1/2 right-0.5 flex -translate-y-1/2 flex-col opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <Hint label={`增加 ${step}`}>
          <button
            aria-label={`增加 ${step}`}
            className="text-muted-foreground hover:text-ink hover:bg-surface-2 flex h-3.5 w-5 items-center justify-center rounded-sm"
            disabled={disabled}
            onClick={() => {
              bump(1);
            }}
            /* mousedown 不夺焦：点箭头不让输入框失焦，落库只走 onCommit 这一条路。 */
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            type="button"
          >
            <ChevronUpIcon aria-hidden size={12} strokeWidth={2.5} />
          </button>
        </Hint>
        <Hint label={`减少 ${step}`}>
          <button
            aria-label={`减少 ${step}`}
            className="text-muted-foreground hover:text-ink hover:bg-surface-2 flex h-3.5 w-5 items-center justify-center rounded-sm"
            disabled={disabled}
            onClick={() => {
              bump(-1);
            }}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            type="button"
          >
            <ChevronDownIcon aria-hidden size={12} strokeWidth={2.5} />
          </button>
        </Hint>
      </div>
    </div>
  );
}
