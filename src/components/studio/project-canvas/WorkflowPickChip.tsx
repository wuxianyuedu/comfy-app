"use client";

/** extracted from WorkflowNode.tsx — workflow picker chip
 *  (Dropdown 2, filtered by source/model). Behaviour and visuals unchanged.
 */
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { PageLoading } from "~/components/ui/page-loading";

export type WorkflowPickOption = {
  id: string;
  name: string;
  taskType?: string;
  sourcePath?: string | null;
  modelTags?: string[];
};

interface WorkflowPickChipProps {
  value: string;
  options: WorkflowPickOption[];
  onSelect: (id: string) => void;
  emptyHint?: string;
  /** 列表仍在加载时显示"加载中"，避免把加载态误渲染成空态。 */
  loading?: boolean;
}

export function WorkflowPickChip({
  value,
  options,
  onSelect,
  emptyHint,
  loading = false,
}: WorkflowPickChipProps) {
  const [open, setOpen] = useState(false);

  const sel = options.find((option) => option.id === value);
  const name = sel?.name ?? "选择工作流";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        className="nodrag nopan border-primary/35 bg-node-accent flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-lg border px-2.5 text-[12px]"
      >
        <span
          className="text-ink-bright min-w-0 flex-1 truncate text-left font-semibold"
          style={{ fontFamily: "var(--font-sans)", fontSize: 11 }}
        >
          {loading && !sel ? (
            <span className="text-ink-muted">加载中…</span>
          ) : sel ? (
            name
          ) : (
            <span className="text-ink-muted">选择工作流…</span>
          )}
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
        aria-label="选择工作流"
        className="border-border-strong bg-card max-h-72 w-[280px] gap-0 overflow-y-auto py-1 shadow-2xl shadow-black/10 dark:shadow-violet-500/20"
      >
        {options.length === 0 &&
          (loading ? (
            <div className="text-ink-muted flex items-center gap-2 px-3 py-3 text-[11px]">
              <PageLoading label="加载中…" className="flex-row gap-2" />
            </div>
          ) : (
            <div className="text-ink-muted px-3 py-3 text-[11px]">
              {emptyHint ?? "暂无符合筛选的工作流"}
            </div>
          ))}
        {options.map((option) => {
          const ol = Boolean(option.sourcePath);
          const active = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={active}
              onClick={() => {
                onSelect(option.id);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors ${
                active
                  ? "bg-violet-500/20 text-violet-700 dark:text-violet-200"
                  : "text-ink-soft hover:bg-subtle"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${ol ? "bg-emerald-400" : "bg-violet-400"}`}
              />
              <span className="min-w-0 flex-1 truncate">{option.name}</span>
              {option.taskType && (
                <span className="bg-subtle text-ink-muted shrink-0 rounded px-1.5 py-0.5 text-[9.5px]">
                  {option.taskType}
                </span>
              )}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
