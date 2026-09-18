"use client";
/* StyleSwitcher + 共享原子表单原语 —— 从 GroupedControls.tsx 抽出。 */
import React from "react";
import { SelectMenu } from "~/components/ui/select-menu";

export type GroupStyle = "split" | "preset";

const STYLE_PREFIX = "comfyapp:wf-group-style:v1";

export function loadGroupStyle(
  workflowId: string | undefined,
  groupId: string,
): GroupStyle {
  if (typeof window === "undefined") return "split";
  try {
    const raw = window.localStorage.getItem(
      `${STYLE_PREFIX}:${workflowId ?? "global"}:${groupId}`,
    );
    return raw === "preset" ? "preset" : "split";
  } catch {
    return "split";
  }
}

export function saveGroupStyle(
  workflowId: string | undefined,
  groupId: string,
  style: GroupStyle,
) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `${STYLE_PREFIX}:${workflowId ?? "global"}:${groupId}`,
      style,
    );
  } catch {
    /* 存储不可用（隐私模式 / 配额）—— 非致命 */
  }
}

/** 切换当前填写范式的分段下拉。 */
export function StyleSwitcher({
  style,
  onChange,
  options,
  narrow,
}: {
  style: GroupStyle;
  onChange: (s: GroupStyle) => void;
  options: { value: GroupStyle; label: string }[];
  /** 画布 / 库内的紧凑版式：下拉按内容收窄，不再拽满整行。 */
  narrow?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-ink-muted shrink-0 text-[10px]">录入方式</span>
      <SelectMenu
        value={style}
        options={options.map((option) => option.value)}
        labels={Object.fromEntries(
          options.map((option) => [option.value, option.label]),
        )}
        className={narrow ? "w-[148px] max-w-full" : "flex-1"}
        onChange={(value) => onChange(value as GroupStyle)}
      />
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <span className="text-ink-muted text-[10px]">{label}</span>
      {children}
    </div>
  );
}
