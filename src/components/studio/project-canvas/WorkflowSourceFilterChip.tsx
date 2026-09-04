"use client";

/** extracted from WorkflowNode.tsx — source filter chip
 *  (本机 / 在线 / 全部). Behaviour and visuals unchanged.
 */
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePopoverDismiss, usePopoverPosition } from "./workflow-node-popover";
import type { WorkflowSourceFilter } from "./WorkflowNode";

interface WorkflowSourceFilterChipProps {
  value: WorkflowSourceFilter;
  onChange: (v: WorkflowSourceFilter) => void;
}

export function WorkflowSourceFilterChip({
  value,
  onChange,
}: WorkflowSourceFilterChipProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const pos = usePopoverPosition(open, triggerRef, 160);
  usePopoverDismiss(open, triggerRef, popRef, () => setOpen(false));

  const isLocal = value === "local";
  const label = value === "all" ? "全部" : isLocal ? "本机" : "在线";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="nodrag nopan flex h-6 shrink-0 items-center gap-1.5 rounded-lg border border-(--color-primary)/35 bg-(--color-node-accent) px-2.5 text-[12px]"
      >
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{
            background:
              value === "all" ? "#8B7CFC" : isLocal ? "#33D499" : "#8B7CFC",
          }}
        />
        <span
          className={`font-semibold ${
            value === "all"
              ? "text-[#A78BFA]"
              : isLocal
                ? "text-[#33D499]"
                : "text-[#A78BFA]"
          }`}
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
            aria-label="工作流来源筛选"
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              width: pos.width,
              zIndex: 50,
            }}
            className="rounded-lg border border-white/8 bg-(--color-card) py-1 shadow-2xl shadow-violet-500/20"
          >
            {(
              [
                { v: "all", label: "全部", dot: "#8B7CFC" },
                { v: "local", label: "本机", dot: "#33D499" },
                { v: "online", label: "在线", dot: "#8B7CFC" },
              ] as { v: WorkflowSourceFilter; label: string; dot: string }[]
            ).map((option) => {
              const sel = option.v === value;
              return (
                <button
                  key={option.v}
                  type="button"
                  role="option"
                  aria-selected={sel}
                  onClick={() => {
                    onChange(option.v);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors ${
                    sel
                      ? "bg-violet-500/20 text-violet-200"
                      : "text-gray-300 hover:bg-white/6"
                  }`}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: option.dot }}
                  />
                  <span className="flex-1">{option.label}</span>
                  {sel && <span className="text-violet-300">✓</span>}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
