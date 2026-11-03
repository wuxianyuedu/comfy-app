"use client";

/**
 * PackageFooter —— ComfyUI 原生风格的节点左下角「包来源」标签。
 * 解析顺序（按 classType）：CUSTOM_NODE_PACKAGE（refreshCustomNodes 的磁盘清单目录名）→
 * config.rawCategory（ComfyUI CATEGORY）→ "Custom" 兜底；内建节点整个隐藏，包名剥掉 "ComfyUI-" 前缀。
 * 作为节点卡片的静态子元素内联渲染（非绝对定位），`pointer-events:none` 永不截获拖拽。 */

import type { NodeTypeConfig } from "~/lib/comfyui/node-config";
import { getCustomNodePackage } from "~/config/custom-nodes";

export function PackageFooter({
  config,
  classType,
  name,
}: {
  classType: string;
  /** 可选 —— 传 `config.custom`/`config.rawCategory` 能得到更丰富的兜底
   *  解析。没有 `NodeTypeConfig` 的调用方（例如工作区编辑器里的 WorkflowNode）
   *  可以省略它，直接给 `name`。 */
  config?: NodeTypeConfig;
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

  if (!display) {
    return null;
  }

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
