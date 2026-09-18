"use client";

// 详情面板的两个复用控件：操作按钮与页签按钮。纯展示，不含业务规则。

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
    <Button
      variant="ghost"
      onClick={onClick}
      className={[
        "relative h-auto rounded-none px-3 py-2.5 text-[12px] font-medium",
        active ? "text-ink-bright" : "text-ink-fainter hover:text-ink-strong",
      ].join(" ")}
    >
      {children}
      {active && (
        <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-linear-to-r from-violet-500 to-fuchsia-500" />
      )}
    </Button>
  );
}
