"use client";

import React from "react";
import { Clock, Folder } from "lucide-react";
import { Button } from "~/components/ui/button";

export type CanvasPanelType = "materials" | "history" | null;

interface CanvasPanelToolbarProps {
  /** 当前打开的面板（null = 无） */
  active: CanvasPanelType;
  /** 用户切换面板时调用 */
  onSelect: (panel: CanvasPanelType) => void;
  /**
   * 为 true 时：渲染成画布内绝对定位的浮动元素
   *（没有面板打开时用）。
   * 为 false 时：渲染成行内 flex 子元素（用在面板容器内部，
   *  与面板竖向居中并排）。
   */
  floating?: boolean;
}

/**
 * 竖向工具栏，用于切换素材库 / 历史面板。
 *
 * 两种模式：
 * - **浮动**（`floating=true`，默认）：绝对定位在画布 left-3。
 * - **行内**（`floating=false`）：普通 flex 子元素，坐在打开的面板左侧。
 */
export function CanvasPanelToolbar({
  active,
  onSelect,
  floating = true,
}: CanvasPanelToolbarProps) {
  const items: { id: CanvasPanelType; label: string; icon: React.ReactNode }[] =
    [
      {
        id: "materials",
        label: "素材库",
        icon: <Folder size={20} strokeWidth={1.8} />,
      },
      {
        id: "history",
        label: "历史记录",
        icon: <Clock size={20} strokeWidth={1.8} />,
      },
    ];

  return (
    <div
      className={`border-border-strong bg-panel/95 dark:shadow-black/50p-blur-md flex flex-col items-center gap-1 rounded-2xl border p-1.5 shadow-xl shadow-black/20 backdrop-blur ${
        floating
          ? "z-canvas-ui absolute top-1/2 left-3 -translate-y-1/2"
          : "shrink-0 self-center"
      }`}
    >
      {items.map((item) => {
        const isActive = active === item.id;
        return (
          <Button
            key={item.id}
            variant="ghost"
            onClick={() => onSelect(isActive ? null : item.id)}
            title={item.label}
            className={`group relative flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-150 ${
              isActive
                ? "bg-violet-500/20 text-violet-700 shadow-sm ring-1 shadow-violet-500/10 ring-violet-500/25 dark:text-violet-300"
                : "text-ink-muted hover:bg-subtle hover:text-ink-soft"
            }`}
          >
            {item.icon}
            {/* Tooltip —— 悬停或激活时显示在按钮右侧 */}
            <span
              className={`border-border-strong bg-panel/95 text-ink-soft pointer-events-none absolute left-full ml-2.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium whitespace-nowrap shadow-xl shadow-black/40 backdrop-blur-sm transition-opacity ${
                isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              }`}
            >
              {item.label}
            </span>
          </Button>
        );
      })}
      {/* 分隔线 */}
      <div className="bg-border-strong mx-1 my-0.5 h-px w-6" />
    </div>
  );
}
