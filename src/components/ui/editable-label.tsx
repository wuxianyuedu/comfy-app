"use client";

import React, { useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { enterCommit } from "~/components/ui/use-enter-commit";

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

  /* 渲染期间把外部 label 变化同步进草稿编辑器
   *（React 19 推荐的「prop 变化时调整状态」模式）。 */
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
       *  text-ink-bright + 'Inter' font-family，与 outputs 的 `text-[12px] font-semibold
       *  text-ink-bright font-Inter'` 视觉严格对齐，让 inputs 与 outputs 在同一节点内
       *  拥有相同字体权重的 label。 */
      <span
        className="group text-ink-bright flex min-w-0 flex-1 items-center gap-1 truncate text-[12px] font-semibold"
        style={{ fontFamily: "var(--font-sans)" }}
        title={title}
      >
        {editable ? (
          /* 需求：直接点击变量名称即可进入改名，不再依赖 ✎ 小按钮。
           * editable 时整个名称是可交互的文本按钮（点击进入编辑态）。 */
          <Button
            variant="ghost"
            aria-label="点击重命名"
            onClick={(event) => {
              event.stopPropagation();
              setDraft(label);
              setEditing(true);
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            className="nodrag nopan text-ink-bright hover:text-ink-strong h-auto min-w-0 flex-1 cursor-text justify-start truncate rounded-none px-0 text-left text-[12px] font-semibold"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            {label}
          </Button>
        ) : (
          <span className="min-w-0 flex-1 truncate">{label}</span>
        )}
      </span>
    );
  }

  const commit = () => {
    const next = draft.trim();
    /* trim 后的值没变时是空操作 —— 免得
     * 每次 blur 都把 workflowIO 表弄脏。 */
    if (next && next !== label) onChange?.(next);
    else setDraft(label);
    setEditing(false);
  };

  return (
    /* 编辑态外层容器保持 flex-1，与展示态一致——行内「必填 / 👁 / 类型徽章」
     * 已由 WidgetInputRow 放到独立右侧收缩区，不再依赖本输入框的宽度去让位。
     * 输入框自身仍为固定 w-32，编辑时只占标签行左侧。 */
    <span className="flex min-w-0 flex-1 items-center gap-1">
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        {...enterCommit({
          onCommit: commit,
          /* Esc 显式回退原值：编辑态与草稿一起复位，下次点开看到的是当前值
           * 而不是上次输入一半的内容。 */
          onCancel: () => {
            setDraft(label);
            setEditing(false);
          },
        })}
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        title={title}
        /* 与展示态字体一致 — text-[12px] font-semibold
         *  text-ink-bright + 'Inter'，避免编辑切回展示态时出现字重跳变。 */
        className="nodrag nopan bg-subtle text-ink-bright w-32 max-w-full min-w-0 shrink rounded border border-violet-400/40 px-1.5 py-px text-[12px] font-semibold outline-none focus:border-violet-400/70"
        style={{ fontFamily: "var(--font-sans)" }}
      />
    </span>
  );
}
