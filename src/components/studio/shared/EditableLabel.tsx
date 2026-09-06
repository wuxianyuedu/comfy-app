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
      /* 字体与 outputs label 一致 — text-[12px] font-semibold
       *  text-(--color-ink-bright) + 'Inter' font-family，与 outputs 的 `text-[12px] font-semibold
       *  text-(--color-ink-bright) font-Inter'` 视觉严格对齐，让 inputs 与 outputs 在同一节点内
       *  拥有相同字体权重的 label。 */
      <span
        className="group flex min-w-0 flex-1 items-center gap-1 truncate text-[12px] font-semibold text-(--color-ink-bright)"
        style={{ fontFamily: "var(--font-sans)" }}
        title={title}
      >
        {editable ? (
          /* 需求：直接点击变量名称即可进入改名，不再依赖 ✎ 小按钮。
           * editable 时整个名称是可交互的文本按钮（点击进入编辑态）。 */
          <button
            type="button"
            aria-label="点击重命名"
            onClick={(event) => {
              event.stopPropagation();
              setDraft(label);
              setEditing(true);
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            className="nodrag nopan min-w-0 flex-1 cursor-text truncate text-left text-[12px] font-semibold text-(--color-ink-bright) transition-colors hover:text-(--color-ink-strong)"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            {label}
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate">{label}</span>
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
    /* 编辑态输入框不铺满整行（不再用 flex-1 抢占），给同一行的
     * 「必填 / 可见」等操作按钮留出稳定空间 —— 输入编辑区域过长会把它们挤出可视区。 */
    <span className="flex min-w-0 items-center gap-1">
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
        onDoubleClick={(event) => event.stopPropagation()}
        title={title}
        /* 与展示态字体一致 — text-[12px] font-semibold
         *  text-(--color-ink-bright) + 'Inter'，避免编辑切回展示态时出现字重跳变。
         * 宽度收紧到 w-32（seed 等短名称够用），并允许收缩，绝不侵占同一行
         * 的「必填 / 👁 可见」操作按钮——太宽会把它们挤出可视区。 */
        className="nodrag nopan min-w-0 w-32 max-w-full shrink rounded border border-violet-400/40 bg-white/6 px-1.5 py-px text-[12px] font-semibold text-(--color-ink-bright) outline-none focus:border-violet-400/70"
        style={{ fontFamily: "var(--font-sans)" }}
      />
    </span>
  );
}
