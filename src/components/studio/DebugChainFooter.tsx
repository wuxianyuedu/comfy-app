"use client";

/**
 * DebugChainFooter — 通用「渲染链路模块标签」组件。
 *
 * 订阅全局 debug-store；仅在调试模式开启时渲染。
 * 每个标签对应一个本项目代码模块：
 *  - 点击：复制该模块的完整相对路径到剪贴板
 *  - hover title：显示完整相对路径
 *  - 防拖拽：阻断 pointer/mouse 事件冒泡，避免触发 ReactFlow 节点拖动
 *
 * 用法：
 *   <DebugChainFooter modules={getWorkflowRenderChainModules(classType)} />
 */

import type { CSSProperties, MouseEvent } from "react";
import { useDebugStore } from "./debug-store";

export interface RenderChainModule {
  /** 完整相对路径（相对项目根，如 src/components/xxx.tsx） */
  file: string;
  /** 标签短名（卡片上显示） */
  label: string;
}

const PILL_STYLE: CSSProperties = {
  cursor: "pointer",
  userSelect: "none",
  fontFamily: '"SF Mono", ui-monospace, monospace',
  fontSize: 9,
  lineHeight: 1,
  padding: "2px 6px",
  borderRadius: 999,
  border: "1px solid rgba(251,191,36,0.35)",
  background: "rgba(251,191,36,0.08)",
  color: "#FBBF24",
  whiteSpace: "nowrap",
};

export function DebugChainFooter({ modules }: { modules: RenderChainModule[] }) {
  const debugMode = useDebugStore((state) => state.debugMode);
  if (!debugMode || modules.length === 0) return null;

  const copyPath = (e: MouseEvent, file: string) => {
    e.stopPropagation();
    e.preventDefault();
    navigator.clipboard?.writeText(file).catch(() => {});
  };

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 3,
        padding: "4px 8px 6px",
        borderTop: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(0,0,0,0.18)",
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onDragStart={(event) => event.preventDefault()}
    >
      {modules.map((module) =>
(
        <span
          key={module.file}
          title={module.file}
          onClick={(event) => copyPath(event, module.file)}
          style={PILL_STYLE}
        >
          {module.label}
        </span>
      ))}
    </div>
  );
}
