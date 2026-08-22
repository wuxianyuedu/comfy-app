"use client";

import { cn } from "@/lib/utils";

/**
 * Tooltip — 轻量悬浮提示（纯 CSS，无 Popper 依赖）。
 *
 * 用法：
 *   <Tooltip label="删除该工作流">
 *     <button>…</button>
 *   </Tooltip>
 *
 * 注意：被包裹元素需可聚焦（button/a）以获得键盘可达性；
 * 纯装饰场景可忽略。
 */
export function Tooltip({
  label,
  children,
  side = "top",
  className,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}) {
  const sideClass: Record<string, string> = {
    top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
    bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
    left: "right-full top-1/2 mr-2 -translate-y-1/2",
    right: "left-full top-1/2 ml-2 -translate-y-1/2",
  };

  return (
    <span className={cn("group/tt relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-[90] hidden whitespace-nowrap rounded-lg border border-white/10 bg-[#1b1b22]/95 px-2.5 py-1.5 text-xs font-medium text-gray-200 shadow-xl shadow-black/40 backdrop-blur-md group-hover/tt:block",
          sideClass[side],
        )}
      >
        {label}
      </span>
    </span>
  );
}
