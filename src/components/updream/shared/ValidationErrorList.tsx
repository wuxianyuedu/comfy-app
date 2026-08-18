// R-Next (2026-08-17): shared renderer for ComfyUI's structured
// `node_errors` (flattened into `ValidationError[]` by
// `src/lib/comfyui/validation.ts`).  Renders a precise per-field list
// ("节点 10（KSampler）· 字段 cfg：cfg must be a number") so the user can
// locate the exact bad input instead of parsing the English summary.
//
// Theme-agnostic: each caller wraps it in its own colored container
// (rose for the canvas error panel, red for the history card).

import type { ValidationError } from "@/lib/comfyui/validation";

export function ValidationErrorList({
  errors,
  className = "",
}: {
  errors: ValidationError[] | null | undefined;
  className?: string;
}) {
  if (!errors || errors.length === 0) return null;
  return (
    <ul className={`space-y-1 ${className}`}>
      {errors.map((e, i) => (
        <li
          key={`${e.nodeId}-${e.field}-${i}`}
          className="flex flex-wrap items-baseline gap-x-1 text-[10.5px] leading-relaxed"
        >
          <span className="font-mono font-semibold">节点 {e.nodeId}</span>
          {e.classType ? (
            <span className="rounded bg-black/30 px-1 font-mono text-[9.5px] opacity-80">
              {e.classType}
            </span>
          ) : null}
          {e.field ? (
            <span>
              · 字段 <span className="font-mono">{e.field}</span>
            </span>
          ) : null}
          <span className="opacity-90">：{e.message}</span>
        </li>
      ))}
    </ul>
  );
}
