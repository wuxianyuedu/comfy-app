"use client";

// 详情面板的复用控件：操作按钮。纯展示，不含业务规则。
//
// 页签不在这里 —— 它走 `ui/tabs` 基元（规范 16 §16.2.4.6 第一档）。

import type { ReactNode } from "react";

import { Button } from "~/components/ui/button";

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
    <Button
      variant={variant === "danger" ? "danger" : "outline"}
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={[
        "h-auto gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium",
        variant === "danger"
          ? "border-destructive/20 disabled:opacity-40"
          : "border-border bg-subtle text-ink-strong hover:bg-surface-2 hover:text-ink-bright disabled:opacity-40",
      ].join(" ")}
    >
      {icon}
      {label}
    </Button>
  );
}
