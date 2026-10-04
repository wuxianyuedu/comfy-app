"use client";
/* StyleSwitcher + 共享原子表单原语 —— 从 GroupedControls.tsx 抽出。 */
import React from "react";
import { SelectMenu } from "~/components/ui/select-menu";
import { readStorageJson, writeStorageItem } from "~/lib/browser-storage";

export type GroupStyle = "split" | "preset";

const STYLE_PREFIX = "comfyapp:wf-group-style:v1";

export function loadGroupStyle(
  workflowId: string | undefined,
  groupId: string,
): GroupStyle {
  /* 非"preset" 的值（含 null / 坏数据 / 未知档）一律回落"split" ——
   * 窄化交给`parse`（§16.2.4.28）。 */
  return readStorageJson(
    `${STYLE_PREFIX}:${workflowId ?? "global"}:${groupId}`,
    "split",
    (raw) => (raw === "preset" ? "preset" : "split"),
  );
}

export function saveGroupStyle(
  workflowId: string | undefined,
  groupId: string,
  style: GroupStyle,
) {
  /* 存储不可用（隐私模式 / 配额）非致命，静默。 */
  writeStorageItem(
    `${STYLE_PREFIX}:${workflowId ?? "global"}:${groupId}`,
    style,
  );
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
      <span className="text-ink-muted text-3xs shrink-0">录入方式</span>
      <SelectMenu
        value={style}
        options={options.map((option) => option.value)}
        labels={Object.fromEntries(
          options.map((option) => [option.value, option.label]),
        )}
        /* 宽档要「占满剩下的宽度」——那是`fullWidth`，不是`flex-1`：
         *`flex-1` 改的是 flex 项的伸缩，而触发器自身仍是内容宽，
         * 旁边的兄弟一变长它就被挤回内容宽。 */
        fullWidth={!narrow}
        className={narrow ? "w-37 max-w-full" : ""}
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
    <div className="flex flex-col gap-1">
      <span className="text-ink-muted text-3xs">{label}</span>
      {children}
    </div>
  );
}
