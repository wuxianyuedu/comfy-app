// ComfyUI 结构化 `node_errors` 的共享渲染器
//（由 src/lib/comfyui/validation.ts 摊平成 `ValidationError[]`）。
// 渲染逐字段的精确清单
//（"节点 10（KSampler）· 字段 cfg：cfg must be a number"），好让用户
// 定位到确切的错误输入，而不必去解析英文摘要。
//
// 与主题无关：每个调用方把它包进各自颜色的容器
//（画布错误面板用玫红，历史卡用红）。
//
// ## 为什么没合到 shadcn `FieldError`（P67 §12.18 中间地带 · 已评估保留）
//
// `pnpm dlx shadcn@latest add field` 之后（#906），`ui/field.tsx` 里的
// `FieldError` 原生支持 `errors: Array<{ message?: string } | undefined>`
// ——自动去重 + 单条渲染成纯文本 + 多条渲染成 `<ul><li>`。**形状看起来
// 与本件重合**，实测**语义与契约完全不同**，不能合：
//
// | 维度 | `FieldError` | 本件 |
// | --- | --- | --- |
// | 位置 | **表单字段行内**（挂在具体 `<Field>` 下） | **面板式清单**（错误面板 / 历史卡 / 结果卡等容器里） |
// | ARIA 契约 | `role="alert"` 与 Field 的 `aria-describedby` 关联 | 无字段绑定，纯展示 |
// | 每行内容 | 只有一条 `message` | **`nodeId` + `classType` + `field` + `message`** 四段结构化信息 |
// | 主题色 | 走 Field 基线的 `text-destructive` | 由调用方在**外层容器**注入（玫红 / 红等，随画布 vs 历史卡而变） |
//
// 强合到 FieldError 会丢字段结构、把「节点 10 · 字段 cfg：…」压成一句
// message、并把面板级色彩绑定回单字段——**是本件刻意的差值**、不是绕开
// 基元（§12.18「有等价就 import，缺的差异用参数或薄封装补」里"缺的差异
// 是本件的核心价值"的情形）。同族的「面板 vs 表单行」分工，见
// `ui/empty-state.tsx` 的 `page` / `hint` 两档保留自绘。

import type { ValidationError } from "~/lib/comfyui/validation";
import { cn } from "~/lib/utils";

export function ValidationErrorList({
  errors,
  className = "",
}: {
  errors: ValidationError[] | null | undefined;
  className?: string;
}) {
  if (!errors || errors.length === 0) return null;
  return (
    <ul className={cn("flex flex-col gap-1", className)}>
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
