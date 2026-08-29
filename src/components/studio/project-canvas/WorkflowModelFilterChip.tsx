"use client";

/** 2026-08-29 T12-3: extracted from WorkflowNode.tsx — model-tag filter chip
 *  (Dropdown 4, 2026-08-15). Behaviour and visuals unchanged.
 */
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePopoverDismiss, usePopoverPosition } from "./workflow-node-popover";

interface WorkflowModelFilterChipProps {
  value: string;
  tags: { id: string; name: string; count: number }[];
  onChange: (v: string) => void;
}

export function WorkflowModelFilterChip({
  value,
  tags,
  onChange,
}: WorkflowModelFilterChipProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const pos = usePopoverPosition(open, triggerRef, 200);
  usePopoverDismiss(open, triggerRef, popRef, () => setOpen(false));

  const label = value === "all" ? "全部模型" : value;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="nodrag nopan flex h-6 shrink-0 items-center gap-1.5 rounded-lg border border-(--color-accent)/35 bg-(--color-node-accent) px-2.5 text-[12px]"
        title={value === "all" ? "按模型筛选" : `已筛选模型：${value}`}
      >
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{
            background:
              value === "all"
                ? "var(--color-accent)"
                : "var(--color-accent-soft)",
          }}
        />
        <span
          className="max-w-[80px] truncate font-semibold text-(--color-accent-soft)"
          style={{ fontFamily: "var(--font-sans)", fontSize: 10 }}
        >
          {label}
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
            aria-label="按模型筛选工作流"
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              width: pos.width,
              zIndex: 50,
            }}
            className="max-h-72 overflow-y-auto rounded-lg border border-white/8 bg-(--color-card) py-1 shadow-2xl shadow-fuchsia-500/20"
          >
            <button
              type="button"
              role="option"
              aria-selected={value === "all"}
              onClick={() => {
                onChange("all");
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors ${
                value === "all"
                  ? "bg-fuchsia-500/20 text-fuchsia-200"
                  : "text-gray-300 hover:bg-white/6"
              }`}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: "var(--color-accent)" }}
              />
              <span className="flex-1">全部模型</span>
              {value === "all" && <span className="text-fuchsia-300">✓</span>}
            </button>
            {tags.length === 0 && (
              <div className="px-3 py-2 text-[10px] text-gray-500">
                标签库为空，去工作流库「管理模型」添加
              </div>
            )}
            {tags.map((tag) => {
              const sel = tag.name === value;
              return (
                <button
                  key={tag.id}
                  type="button"
                  role="option"
                  aria-selected={sel}
                  onClick={() => {
                    onChange(tag.name);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors ${
                    sel
                      ? "bg-fuchsia-500/20 text-fuchsia-200"
                      : "text-gray-300 hover:bg-white/6"
                  }`}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: "var(--color-accent-soft)" }}
                  />
                  <span className="flex-1 truncate">{tag.name}</span>
                  <span className="text-[9px] text-gray-500 tabular-nums">
                    {tag.count}
                  </span>
                  {sel && <span className="text-fuchsia-300">✓</span>}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
