"use client";

/**
 * PackageFooter —— ComfyUI 原生风格的左下角「包来源」标签。
 *
 * ComfyUI 会在每个画布节点左下角画一个很淡的小标签，标出这个节点
 * 来自哪个包（"DaSiWa-Nodes"、"ComfyMath"、"rgthree-comfy" …）。
 * 排查「这个节点从哪来的」时它非常有用，也和原生 UX 一致，
 * 所以编辑器渲染的每个节点都镜像一份。
 *
 * 解析顺序（按 `classType`）：
 *   1. `refreshCustomNodes()` 填充的 CUSTOM_NODE_PACKAGE 表 —— 取磁盘清单
 *      里的目录名原样（"DaSiWa-Nodes"、"ComfyMath"、"rgthree-comfy" …）。
 *      清单还没拉到（例如挂载前）时为空。
 *   2. config.rawCategory —— ComfyUI 自己的 `CATEGORY` 属性；
 *      解析结果里有条目但没有 `package` 字段时用它。
 *   3. "Custom" —— 无法归类的自定义节点的兜底。
 *
 * 显示规则：
 *   - 内建节点（没有自定义包）原来会显示字面量前缀
 *     "ComfyUI"。按用户要求不再显示该前缀 —— 内建节点直接
 *     整个隐藏底栏。
 *   - 自定义包常带 "ComfyUI-" 目录前缀
 *     （如 "ComfyUI-DaSiWa-Nodes"）。该前缀会被剥掉，标签
 *     只读 "DaSiWa-Nodes"。没有前缀的包原样显示。
 *   - 标签渲染成一个带 1px 细边框的小药丸，
 *     好让来源名在视觉上区分得出来。
 *
 * 注意：作为节点卡片的静态子元素**内联渲染**（**不是**
 * 绝对定位）。这样它自然排在 I/O 行下方，
 * 不会与行重叠，也交给 ReactFlow 的自动测量处理新增
 * 高度。`pointer-events:none` 让它永不截获拖拽手势。
 */

import type { NodeTypeConfig } from "~/lib/comfyui/node-config";
import { getCustomNodePackage } from "~/config/custom-nodes";

export function PackageFooter({
  config,
  classType,
  name,
}: {
  /** 可选 —— 传 `config.custom`/`config.rawCategory` 能得到更丰富的兜底
   *  解析。没有 `NodeTypeConfig` 的调用方（例如工作区编辑器里的 WorkflowNode）
   *  可以省略它，直接给 `name`。 */
  config?: NodeTypeConfig;
  classType: string;
  /** 覆盖解析出的名字。给了就原样使用（例如调用方
   *  已经用 `getCustomNodePackage()` 算出了正确的包名）。 */
  name?: string;
}) {
  const resolved =
    name ??
    (config?.custom
      ? (getCustomNodePackage(classType) ?? config.rawCategory ?? "Custom")
      : "ComfyUI");

  // 内建节点永远只会解析出字面量 "ComfyUI" 前缀 —— 按
  // 要求不显示它，于是隐藏底栏。自定义包会剥掉
  // "ComfyUI-" 目录前缀，标签更干净。
  const display =
    resolved === "ComfyUI"
      ? ""
      : resolved.startsWith("ComfyUI-")
        ? resolved.slice("ComfyUI-".length)
        : resolved;

  if (!display) return null;

  return (
    <div
      className="comfy-node__package"
      data-package={resolved}
      style={{
        display: "inline-block",
        alignSelf: "flex-start",
        marginTop: 4,
        marginLeft: 2,
        padding: "2px 6px",
        fontSize: 9,
        lineHeight: 1.2,
        fontFamily: "var(--font-mono)",
        /* 包脚注叠在节点表面上（随主题），文本/边框都必须跟着走。
           写死 50% 白 + 22% 白两态都只对深色底成立。 */
        color: "var(--color-ink-fainter)",
        letterSpacing: 0.3,
        border: "1px solid var(--color-border-strong)",
        borderRadius: 4,
        pointerEvents: "none",
        userSelect: "none",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: "calc(100% - 4px)",
      }}
      title={`来源包: ${resolved}`}
    >
      {display}
    </div>
  );
}
