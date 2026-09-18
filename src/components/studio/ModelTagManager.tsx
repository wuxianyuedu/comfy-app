"use client";

import { useCallback, useState } from "react";
import { Icon } from "~/components/ui/icon";

import { useModelTags, type TagItem } from "./hooks/use-model-tags";
import { overlayClass } from "~/lib/full-screen-layer";

interface ModelTagManagerProps {
  /** Initial tags (from the parent's cached library list). */
  initialTags: TagItem[];
  /** Called after any create/delete so the parent can refresh its list. */
  onChanged: () => void;
  /** Called when the user closes the dialog. */
  onClose: () => void;
}

/** Modal dialog for managing the user-level workflow model-tag library.
 *  Tags are shared across all of a user's workflows (e.g. "z-image",
 *  "wan2.2"); creating one here makes it available in every workflow card's
 *  "＋ 标签" menu and in the library's model filter.
 *
 * 视图层（规范 17 §17.2 第③层）：列表合并与三个写动作在
 * hooks/use-model-tags.ts；本文件只渲染。对外 props 与导出名保持不变。 */
export function ModelTagManager({
  initialTags,
  onChanged,
  onClose,
}: ModelTagManagerProps) {
  const c = useModelTags({ initialTags, onChanged });

  /* 内联重命名态是纯视觉状态（哪一行在编辑），留在视图层 */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const beginEdit = useCallback((id: string, currentName: string) => {
    setEditingId(id);
    setEditingDraft(currentName);
  }, []);
  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditingDraft("");
  }, []);
  const commitEdit = useCallback(
    (id: string, oldName: string) => {
      void c.renameTag(oldName, editingDraft).then((ok) => {
        if (ok) cancelEdit();
      });
    },
    [c, editingDraft, cancelEdit],
  );

  return (
    <div
      className={overlayClass(
        "modal",
        "z-overlay flex items-center justify-center bg-black/25 p-4 dark:bg-black/60",
      )}
      onClick={onClose}
    >
      <div
        className="border-border-strong bg-panel w-full max-w-md rounded-2xl border p-5 shadow-2xl shadow-black/20 dark:shadow-black/50"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="管理模型标签"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-ink-bright flex items-center gap-2 text-base font-semibold">
            <Icon
              name="tag"
              className="h-4 w-4 text-fuchsia-700 dark:text-fuchsia-300"
            />
            模型标签库
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-soft hover:bg-subtle hover:text-ink-bright rounded-lg p-1"
            aria-label="关闭"
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>

        <p className="text-ink-soft mb-3 text-xs leading-relaxed">
          这些标签是<strong className="text-ink-bright">用户级全局库</strong>
          ，可跨多个工作流复用。 在这里新增/删除后，即可在工作流卡片上「＋
          标签」绑定，并在上方按模型筛选。
        </p>

        <div className="mb-4 flex gap-2">
          <input
            value={c.draft}
            onChange={(event) => c.setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void c.addTag();
            }}
            placeholder="新增模型名，如 z-image / wan2.2"
            className="border-border-strong bg-canvas-deep text-ink-bright placeholder:text-ink-muted min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:border-fuchsia-500/50"
          />
          <button
            type="button"
            onClick={() => void c.addTag()}
            disabled={c.busy || !c.draft.trim()}
            className="rounded-lg bg-fuchsia-500/90 px-3 py-2 text-sm font-semibold text-white hover:bg-fuchsia-500 disabled:opacity-50"
          >
            {c.busy ? "…" : "添加"}
          </button>
        </div>

        {c.error && (
          <div className="mb-3 text-xs text-red-700 dark:text-red-400">
            {c.error}
          </div>
        )}

        <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-1">
          {c.tags.length === 0 && (
            <div className="text-ink-muted py-6 text-center text-sm">
              还没有模型标签
            </div>
          )}
          {c.tags.map((tag) => {
            const isEditing = editingId === tag.id;
            return (
              <div
                key={tag.id}
                className="border-border-strong bg-subtle flex items-center justify-between rounded-lg border px-3 py-2"
              >
                {isEditing ? (
                  <input
                    autoFocus
                    value={editingDraft}
                    maxLength={64}
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => setEditingDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void commitEdit(tag.id, tag.name);
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        cancelEdit();
                      }
                    }}
                    // NOTE: intentionally no onBlur → commit. If the user dismisses
                    // the editor by other means (clicking outside, the dialog
                    // closing), the local state advances but no rename is sent.
                    // Saves must go through Enter (the only intentional save path),
                    // otherwise two commits would race (e.g. Enter + blur both fire
                    // and the second one sees the now-renamed tag as 404).
                    onBlur={() => cancelEdit()}
                    className="bg-canvas-deep text-ink-bright min-w-0 flex-1 rounded-md border border-fuchsia-500/50 px-2 py-0.5 text-sm outline-none focus:border-fuchsia-400"
                  />
                ) : (
                  <span
                    onDoubleClick={() => beginEdit(tag.id, tag.name)}
                    title="双击重命名"
                    className="text-ink-bright hover:bg-subtle hover:text-ink-bright cursor-text truncate rounded-sm px-0.5 text-sm select-none"
                  >
                    {tag.name}
                  </span>
                )}
                <div className="flex shrink-0 items-center gap-2">
                  <span className="bg-surface-2 text-ink-soft rounded-full px-2 py-0.5 text-[11px] tabular-nums">
                    {tag.count} 个工作流
                  </span>
                  <button
                    type="button"
                    onClick={() => void c.deleteTag(tag.name, tag.count)}
                    disabled={isEditing}
                    title={
                      tag.count > 0
                        ? `删除「${tag.name}」，会一并解除 ${tag.count} 个工作流的绑定`
                        : `删除「${tag.name}」`
                    }
                    className="text-ink-soft rounded-md border border-transparent p-1 hover:border-red-400/40 hover:bg-red-500/15 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-300"
                    aria-label={`删除 ${tag.name}`}
                  >
                    <Icon name="trash" className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
