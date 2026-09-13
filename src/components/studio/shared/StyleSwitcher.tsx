"use client";
/* StyleSwitcher + shared atomic form primitives — extracted from GroupedControls.tsx. */
import React from "react";
import { DarkSelect } from "@/components/studio/ui/DarkSelect";

export type GroupStyle = "split" | "preset";

const STYLE_PREFIX = "comfyapp:wf-group-style:v1";

export function loadGroupStyle(workflowId: string | undefined, groupId: string): GroupStyle {
  if (typeof window === "undefined") return "split";
  try {
    const raw = window.localStorage.getItem(`${STYLE_PREFIX}:${workflowId ?? "global"}:${groupId}`);
    return raw === "preset" ? "preset" : "split";
  } catch {
    return "split";
  }
}

export function saveGroupStyle(workflowId: string | undefined, groupId: string, style: GroupStyle) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${STYLE_PREFIX}:${workflowId ?? "global"}:${groupId}`, style);
  } catch {
    /* storage unavailable (private mode / quota) — non-fatal */
  }
}

/** Segmented dropdown that flips the active fill paradigm. */
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
      <span className="shrink-0 text-[10px] text-gray-500">录入方式</span>
      <DarkSelect
        value={style}
        options={options.map((option) => option.value)}
        labels={Object.fromEntries(options.map((option) => [option.value, option.label]))}
        className={narrow ? "w-[148px] max-w-full" : "flex-1"}
        onChange={(value) => onChange(value as GroupStyle)}
      />
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="text-[10px] text-(--color-ink-muted)">{label}</span>
      {children}
    </div>
  );
}
