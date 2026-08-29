"use client";

import React, { useRef, useState } from "react";

export function EditableLabel({
  label,
  title,
  onChange,
}: {
  label: string;
  title?: string;
  onChange?: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const inputRef = useRef<HTMLInputElement>(null);
  const editable = typeof onChange === "function";

  /* Sync external label changes into the draft editor during render
   * (React 19 recommended "adjusting state when a prop changes" pattern). */
  const [prevLabel, setPrevLabel] = useState(label);
  if (label !== prevLabel) {
    setPrevLabel(label);
    setDraft(label);
  }

  React.useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  if (!editable || !editing) {
    return (
      /* R-ardot56 (2026-08-15): 字体与 outputs label 一致 — text-[12px] font-semibold
       *  text-(--color-ink-bright) + 'Inter' font-family，与 outputs 的 `text-[12px] font-semibold
       *  text-(--color-ink-bright) font-Inter'` 视觉严格对齐，让 inputs 与 outputs 在同一节点内
       *  拥有相同字体权重的 label。 */
      <span
        className="group flex min-w-0 flex-1 items-center gap-1 truncate text-[12px] font-semibold text-(--color-ink-bright)"
        style={{ fontFamily: "var(--font-sans)" }}
        title={title}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {editable && (
          <button
            type="button"
            aria-label="编辑名称"
            title="编辑名称"
            onClick={(event) => {
              event.stopPropagation();
              setDraft(label);
              setEditing(true);
            }}
            onMouseDown={(event) => event.stopPropagation()}
            className="shrink-0 text-[10px] text-gray-500 opacity-30 transition-opacity hover:opacity-100 group-hover:opacity-70"
          >
            ✎
          </button>
        )}
      </span>
    );
  }

  const commit = () => {
    const next = draft.trim();
    /* No-op when the trimmed value is unchanged — avoids dirtying the
     * workflowIO map on every blur. */
    if (next && next !== label) onChange?.(next);
    else setDraft(label);
    setEditing(false);
  };

  return (
    <span className="flex min-w-0 flex-1 items-center gap-1">
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setDraft(label);
            setEditing(false);
          }
        }}
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        title={title}
        /* R-ardot56 (2026-08-15): 与展示态字体一致 — text-[12px] font-semibold
         *  text-(--color-ink-bright) + 'Inter'，避免编辑切回展示态时出现字重跳变。 */
        className="nodrag nopan min-w-0 flex-1 rounded border border-violet-400/40 bg-white/6 px-1.5 py-px text-[12px] font-semibold text-(--color-ink-bright) outline-none focus:border-violet-400/70"
        style={{ fontFamily: "var(--font-sans)" }}
      />
    </span>
  );
}

