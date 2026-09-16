"use client";

// 模型标签绑定选择器：点击展开用户级标签库多选，可内联新建标签。
// 纯展示 —— 写操作通过 controller 上抛，由 hook 持久化。
// 触发按钮与详情头部其它操作按钮（导入画布 / 编辑 / 下载）同款式。

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { MetaEditorController } from "../hooks/use-workflow-library-detail";
import { overlayClass } from "~/lib/full-screen-layer";

export function ModelTagPicker({ meta }: { meta: MetaEditorController }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(
    () => new Set(meta.modelTags),
  );
  const [newName, setNewName] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Reset draft only on the closed → open transition, so mid-edit re-renders
  // don't wipe the user's selection.
  const [prevOpen, setPrevOpen] = useState(false);
  if (open && !prevOpen) {
    setPrevOpen(true);
    setDraft(new Set(meta.modelTags));
    setNewName("");
  } else if (!open && prevOpen) {
    setPrevOpen(false);
  }

  const knownNames = useMemo(
    () => meta.allModelTags.map((tag) => tag.name),
    [meta.allModelTags],
  );
  // 草稿里可能有尚未入库的新名字 —— 一并展示，避免已勾选项消失。
  const options = useMemo(() => {
    const set = new Set([...knownNames, ...draft]);
    return Array.from(set);
  }, [knownNames, draft]);

  const toggle = (name: string) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const save = async () => {
    setOpen(false);
    await meta.patchModelTags(Array.from(draft));
  };

  const label =
    meta.modelTags.length > 0 ? meta.modelTags.join("、") : "选择模型";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="border-border bg-subtle text-ink-strong hover:bg-surface-2 hover:text-ink inline-flex max-w-[260px] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors"
        title={`${label}（点击管理模型标签绑定）`}
      >
        <span className="truncate">{label}</span>
        <span
          className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popRef}
            role="dialog"
            aria-label="模型标签编辑器"
            className={overlayClass(
              "modal",
              "bg-canvas-deep z-50 flex items-start justify-center p-4 pt-24",
            )}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
          >
            <div className="border-border bg-card w-80 rounded-xl border p-3 shadow-2xl">
              <p className="text-ink-bright mb-2 text-xs font-medium">
                绑定模型标签（{draft.size}）
              </p>
              <div className="mb-2 flex max-h-56 flex-col gap-1 overflow-y-auto">
                {knownNames.length === 0 && (
                  <p className="text-ink-muted px-2 py-1.5 text-[11px] leading-relaxed">
                    全局标签库为空，可直接在下方输入新标签（保存时自动入库）。
                  </p>
                )}
                {options.map((name) => {
                  const selected = draft.has(name);
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => toggle(name)}
                      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                        selected
                          ? "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300"
                          : "text-ink-strong hover:bg-subtle"
                      }`}
                    >
                      <span
                        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                          selected
                            ? "border-fuchsia-400/60 bg-fuchsia-500/40"
                            : "border-border-strong bg-subtle"
                        }`}
                      >
                        {selected && "✓"}
                      </span>
                      <span className="truncate">{name}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mb-2 flex gap-1.5">
                <input
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      const name = newName.trim();
                      if (name) {
                        toggle(name);
                        setNewName("");
                      }
                    }
                  }}
                  placeholder="新增标签，如 z-image"
                  className="border-border bg-subtle text-ink-bright placeholder:text-ink-muted h-7 min-w-0 flex-1 rounded-md border px-2 text-xs focus:border-fuchsia-400/40 focus:outline-none"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="bg-subtle text-ink-strong hover:bg-surface-2 flex-1 rounded-md px-3 py-1.5 text-xs transition-colors"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void save()}
                  className="flex-1 rounded-md bg-fuchsia-500/90 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-fuchsia-500"
                >
                  保存
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
