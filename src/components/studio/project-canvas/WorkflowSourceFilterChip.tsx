"use client";

/** 从 WorkflowNode.tsx 抽出的「来源筛选」chip（本机 / 在线 / 全部）。
 *  行为与外观保持不变。
 */
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Button } from "~/components/ui/button";
/* 类型来自叶子模块而不是宿主：经宿主会形成
 * `WorkflowNode → chip → WorkflowNode` 的循环（规范 12.7）。 */
import type { WorkflowSourceFilter } from "./workflow-node-types";

interface WorkflowSourceFilterChipProps {
  value: WorkflowSourceFilter;
  onChange: (v: WorkflowSourceFilter) => void;
}

export function WorkflowSourceFilterChip({
  value,
  onChange,
}: WorkflowSourceFilterChipProps) {
  const [open, setOpen] = useState(false);

  const isLocal = value === "local";
  const label = value === "all" ? "全部" : isLocal ? "本机" : "在线";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        className="nodrag nopan border-primary/35 bg-overlay-accent-surface flex h-6 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[12px]"
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            isLocal ? "bg-status-online" : "bg-primary-strong"
          }`}
        />
        <span
          className={`text-[10px] font-semibold ${
            isLocal ? "text-status-online" : "text-primary-strong"
          }`}
          style={{ fontFamily: "var(--font-sans)" }}
        >
          {label}
        </span>
        <span
          className={`text-ink-icon shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          style={{ fontFamily: "var(--font-sans)", fontSize: 9 }}
        >
          ▾
        </span>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        aria-label="工作流来源筛选"
        className="border-border-strong bg-card w-40 gap-0 py-1 shadow-2xl shadow-black/10 dark:shadow-violet-500/20"
      >
        {(
          [
            { v: "all", label: "全部", local: false },
            { v: "local", label: "本机", local: true },
            { v: "online", label: "在线", local: false },
          ] as { v: WorkflowSourceFilter; label: string; local: boolean }[]
        ).map((option) => {
          const sel = option.v === value;
          return (
            <Button
              key={option.v}
              variant="ghost"
              role="option"
              aria-selected={sel}
              onClick={() => {
                onChange(option.v);
                setOpen(false);
              }}
              className={`flex h-auto w-full items-center gap-2 rounded-none px-3 py-1.5 text-left text-[11px] font-normal transition-colors ${
                sel
                  ? "bg-primary-soft text-primary-strong"
                  : "text-ink-soft hover:bg-subtle"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  option.local ? "bg-status-online" : "bg-primary-strong"
                }`}
              />
              <span className="flex-1">{option.label}</span>
              {sel && <span className="text-primary-strong">✓</span>}
            </Button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
