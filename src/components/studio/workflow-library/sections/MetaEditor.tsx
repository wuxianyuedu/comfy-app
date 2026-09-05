"use client";

// 详情面板的「类型 / 模型」编辑器：复用 MultiModeSelect（多模式）与模型标签
// 多选 chip。纯展示 —— 写操作通过 controller 上抛，由 hook 持久化。

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ALL_WORKFLOW_TYPES } from "@/lib/workflow-types";
import { MultiModeSelect } from "~/components/studio/ui/MultiModeSelect";
import type { MetaEditorController } from "../hooks/use-workflow-library-detail";

/** 模式码 → 中文标签（未知码原样显示，兼容历史自定义值）。 */
function modeLabel(code: string): string {
  return ALL_WORKFLOW_TYPES.find((type) => type.code === code)?.label ?? code;
}

export function MetaEditor({ meta }: { meta: MetaEditorController }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-white/40">类型</span>
        <MultiModeSelect
          modes={meta.modes}
          defaultMode={meta.defaultMode}
          hideExtraBadge
          onChange={(modes, defaultMode) => {
            void meta.patchModes(modes, defaultMode);
          }}
        />
      </div>
      <ModelTagPicker meta={meta} />
    </div>
  );
}

/** 全部已选模式的 chips，渲染在类型 / 模型行的上方 —— 替代下拉框右侧的
 *  「+N」徽标，让多模式一眼可见；默认模式加描边高亮。 */
export function ModeChips({ meta }: { meta: MetaEditorController }) {
  if (meta.modes.length === 0) return null;
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
      {meta.modes.map((code) => {
        const isDefault = code === meta.defaultMode;
        return (
          <button
            key={code}
            type="button"
            title={isDefault ? "默认模式" : "点击设为默认模式"}
            onClick={() => {
              if (!isDefault) void meta.patchModes(meta.modes, code);
            }}
            className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
              isDefault
                ? "bg-violet-500/15 text-violet-300 ring-1 ring-inset ring-violet-500/25"
                : "bg-white/4 text-gray-400 hover:bg-violet-500/10 hover:text-violet-200"
            }`}
          >
            {modeLabel(code)}
          </button>
        );
      })}
    </div>
  );
}

/** 模型标签绑定：点击展开用户级标签库多选，可内联新建标签。 */
function ModelTagPicker({ meta }: { meta: MetaEditorController }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(() => new Set(meta.modelTags));
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
        className="inline-flex max-w-[260px] items-center gap-1.5 rounded-md border border-fuchsia-500/25 bg-fuchsia-500/15 px-2 py-0.5 text-[11px] font-medium text-fuchsia-200 transition-colors hover:bg-fuchsia-500/25"
        title={label}
      >
        <span className="truncate">{label}</span>
        <span className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popRef}
            role="dialog"
            aria-label="模型标签编辑器"
            className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-24"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
          >
            <div className="w-80 rounded-xl border border-white/10 bg-[#1b1b24] p-3 shadow-2xl">
              <p className="mb-2 text-xs font-medium text-gray-200">
                绑定模型标签（{draft.size}）
              </p>
              <div className="mb-2 flex max-h-56 flex-col gap-1 overflow-y-auto">
                {knownNames.length === 0 && (
                  <p className="px-2 py-1.5 text-[11px] leading-relaxed text-gray-500">
                    全局标签库为空，可先在页头「管理模型」中添加，或直接在下方输入新标签（保存时自动入库）。
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
                          ? "bg-fuchsia-500/15 text-fuchsia-100"
                          : "text-gray-300 hover:bg-white/5"
                      }`}
                    >
                      <span
                        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                          selected
                            ? "border-fuchsia-400/60 bg-fuchsia-500/40"
                            : "border-white/20 bg-white/5"
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
                  className="h-7 min-w-0 flex-1 rounded-md border border-white/10 bg-white/5 px-2 text-xs text-gray-200 placeholder:text-gray-500 focus:border-fuchsia-400/40 focus:outline-none"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex-1 rounded-md bg-white/5 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-white/10"
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
