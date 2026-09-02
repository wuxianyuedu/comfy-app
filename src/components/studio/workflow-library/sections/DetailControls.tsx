"use client";

// 详情面板的两个复用控件：操作按钮与页签按钮。纯展示，不含业务规则。

import type { ReactNode } from "react";

export function ActionButton({
  onClick,
  icon,
  label,
  title,
  disabled,
  variant = "default",
}: {
  onClick: () => void;
  icon: ReactNode;
  label: string;
  title?: string;
  disabled?: boolean;
  variant?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={[
        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors",
        variant === "danger"
          ? "border-red-500/20 bg-red-500/8 text-red-300 hover:bg-red-500/15 disabled:opacity-40"
          : "border-white/10 bg-white/[0.04] text-white/75 hover:bg-white/[0.08] hover:text-white disabled:opacity-40",
      ].join(" ")}
    >
      {icon}
      {label}
    </button>
  );
}

export function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "relative px-3 py-2.5 text-[12px] font-medium transition-colors",
        active ? "text-white" : "text-white/45 hover:text-white/75",
      ].join(" ")}
    >
      {children}
      {active && (
        <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-linear-to-r from-violet-500 to-fuchsia-500" />
      )}
    </button>
  );
}
