"use client";

import React from "react";
import { Clock, Folder } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";

export type CanvasPanelType = "materials" | "history" | null;

type CanvasPanelToolbarProps = {
  /** 当前打开的面板（null = 无） */
  active: CanvasPanelType;
  /**
   * 为 true 时：渲染成画布内绝对定位的浮动元素
   *（没有面板打开时用）。
   * 为 false 时：渲染成行内 flex 子元素（用在面板容器内部，
   *  与面板竖向居中并排）。
   */
  floating?: boolean;
  /** 用户切换面板时调用 */
  onSelect: (panel: CanvasPanelType) => void;
};

/**
 * 竖向工具栏，用于切换素材库 / 历史面板。
 *
 * 两种模式：
 * - **浮动**（`floating=true`，默认）：绝对定位在画布 left-3。
 * - **行内**（`floating=false`）：普通 flex 子元素，坐在打开的面板左侧。
 */
export function CanvasPanelToolbar({ active, onSelect, floating = true }: CanvasPanelToolbarProps) {
  const items: Array<{ icon: React.ReactNode; id: CanvasPanelType; label: string }> = [
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
      className={`border-border-strong bg-panel flex flex-col items-center gap-1 rounded-2xl border p-1.5 shadow-xl shadow-black/20 dark:shadow-black/50 ${
        floating ? "z-canvas-ui absolute top-1/2 left-3 -translate-y-1/2" : "shrink-0 self-center"
      }`}
    >
      {items.map((item) => {
        const isActive = active === item.id;
        return (
          <Hint key={item.id} label={item.label}>
            <Button
              /* 选中档**钉住悬停值**（`hover:bg-primary/20` / `hover:text-primary-strong`）：
                 `ghost` 变体自带 `hover:bg-muted hover:text-foreground`，而选中
                 分支原本没写 `hover:` —— 划过**当前打开**的那一枚时悬停档胜出，
                 紫色高亮翻成灰底黑字，看上去像「未选中」（用户原话「悬浮和非
                 悬浮一个紫一个白」那一族，ISSUE #1423 / 规范 16 §16.2.4.75）。
                 这一枚是**开关**（再点一次关闭面板）而非单选 radio，所以不走
                 `SelectChip`，就地钉住悬停值。 */
              className={`group relative flex size-10 items-center justify-center rounded-xl transition-all duration-150 ${
                isActive
                  ? "bg-primary/20 text-primary-strong hover:bg-primary/20 hover:text-primary-strong shadow-primary/10 ring-primary/25 shadow-sm ring-1"
                  : "text-ink-muted hover:bg-subtle hover:text-ink-soft"
              }`}
              onClick={() => {
                onSelect(isActive ? null : item.id);
              }}
              variant="ghost"
            >
              {item.icon}
              {/* Tooltip —— 悬停或激活时显示在按钮右侧 */}
              <span
                className={`border-border-strong bg-panel text-ink-soft text-2xs pointer-events-none absolute left-full ml-2.5 rounded-lg border px-2.5 py-1 font-medium whitespace-nowrap shadow-xl shadow-black/40 transition-opacity ${
                  isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                }`}
              >
                {item.label}
              </span>
            </Button>
          </Hint>
        );
      })}
      {/* 分隔线 */}
      <div className="bg-border-strong mx-1 my-0.5 h-px w-6" />
    </div>
  );
}
