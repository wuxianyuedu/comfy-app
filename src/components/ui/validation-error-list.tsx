// ComfyUI 结构化 `node_errors` 的共享渲染器
//（由 src/lib/comfyui/validation.ts 摊平成 `ValidationError[]`）。
// 渲染逐字段的精确清单
//（"节点 10（KSampler）· 字段 cfg：cfg must be a number"），好让用户
// 定位到确切的错误输入，而不必去解析英文摘要。
//
// 与主题无关：每个调用方把它包进各自颜色的容器
//（画布错误面板用玫红，历史卡用红）。

import type { ValidationError } from "~/lib/comfyui/validation";

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
      {errors.map((error, index) => (
        <li
          key={`${error.nodeId}-${error.field}-${index}`}
          className="flex flex-wrap items-baseline gap-x-1 text-[10.5px] leading-relaxed"
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
