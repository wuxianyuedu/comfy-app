"use client";

/** extracted from WorkflowNode.tsx — workflow picker chip
 *  (Dropdown 2, filtered by source/model). Behaviour and visuals unchanged.
 */
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui/icon";
import { usePopoverDismiss, usePopoverPosition } from "./workflow-node-popover";

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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const pos = usePopoverPosition(open, triggerRef, 280);
  usePopoverDismiss(open, triggerRef, popRef, () => setOpen(false));

  const sel = options.find((option) => option.id === value);
  const name = sel?.name ?? "选择工作流";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="nodrag nopan flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-(--color-primary)/35 bg-(--color-node-accent) px-2.5 text-[12px]"
      >
        <span
          className="min-w-0 flex-1 truncate text-left font-semibold text-ink-bright"
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
          className={`shrink-0 text-(--color-ink-icon) transition-transform ${open ? "rotate-180" : ""}`}
          style={{ fontFamily: "var(--font-sans)", fontSize: 9 }}
        >
          ▾
        </span>
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popRef}
            role="listbox"
            aria-label="选择工作流"
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              width: pos.width,
              zIndex: 50,
            }}
            className="border-border-strong bg-card max-h-72 overflow-y-auto rounded-lg border py-1 shadow-2xl shadow-black/10 dark:shadow-violet-500/20"
          >
            {options.length === 0 &&
              (loading ? (
                <div className="text-ink-muted flex items-center gap-2 px-3 py-3 text-[11px]">
                  <Icon name="loader" size={12} className="animate-spin" />
                  加载中…
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
                      ? "bg-violet-500/20 text-violet-200"
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
          </div>,
          document.body,
        )}
    </>
  );
}
