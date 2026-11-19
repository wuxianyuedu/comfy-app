// ComfyUI 结构化 `node_errors` 的共享渲染器（由 src/lib/comfyui/validation.ts 摊平成 `ValidationError[]`），
// 逐字段给出精确清单（"节点 10（KSampler）· 字段 cfg：cfg must be a number"）；与主题无关，调用方各自
// 包进带颜色的容器（画布错误面板玫红 / 历史卡红）。P67 §12.18 已评估保留、不合到 shadcn `FieldError`：
// 后者是表单字段行内、靠 `aria-describedby` 绑定且每行只有一条 message；本件是面板式纯展示清单，
// 每行四段结构（nodeId/classType/field/message），强合会丢字段结构并把面板级色彩绑回单字段（同族分工见 `ui/empty-state.tsx`）。

import type { ValidationError } from "~/lib/comfyui/validation";
import { cn } from "~/lib/utils";

export function ValidationErrorList({
  errors,
  className = "",
}: {
  className?: string;
  errors: Array<ValidationError> | null | undefined;
}) {
  if (!errors || errors.length === 0) {
    return null;
  }
  return (
    <ul className={cn("flex flex-col gap-1", className)}>
      {errors.map((error, index) => (
        <li
          className="text-2xs flex flex-wrap items-baseline gap-x-1 leading-relaxed"
          key={`${error.nodeId}-${error.field}-${index}`}
        >
          <span className="font-mono font-semibold">节点 {error.nodeId}</span>
          {error.classType ? (
            <span className="bg-canvas-deep rounded px-1 font-mono text-[9.5px] opacity-80">
              {error.classType}
            </span>
          ) : null}
          {error.field ? (
            <span>
              · 字段 <span className="font-mono">{error.field}</span>
            </span>
          ) : null}
          <span className="opacity-90">：{error.message}</span>
        </li>
      ))}
    </ul>
  );
}
