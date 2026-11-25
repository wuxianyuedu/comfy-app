"use client";

// 详情面板的复用控件：操作按钮。纯展示，不含业务规则。
//
// 页签不在这里 —— 它走 `ui/tabs` 基元（规范 16 §16.2.4.6 第一档）。

import type { ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";

export function ActionButton({
  onClick,
  icon,
  label,
  title,
  disabled,
  variant = "default",
}: {
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  title?: string;
  /** primary = 实心品牌色主按钮（一屏只有一个，当前是「编辑」）；
   *  danger = 危险操作；default = 描边次级。 */
  variant?: "default" | "danger" | "primary";
}) {
  return (
    <Hint label={title ?? label} wrap>
      <Button
        className={[
          "text-2xs h-auto gap-1.5 rounded-lg px-2.5 py-1.5 font-medium",
          variant === "danger"
            ? "border-destructive/20 border disabled:opacity-40"
            : variant === "primary"
              ? "disabled:opacity-40"
              : "border-border bg-subtle text-ink-strong hover:bg-surface-2 hover:text-ink-bright border disabled:opacity-40",
        ].join(" ")}
        disabled={disabled}
        onClick={onClick}
        variant={variant === "danger" ? "danger" : variant === "primary" ? "default" : "outline"}
      >
        {icon}
        {label}
      </Button>
    </Hint>
  );
}
