"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { vanillaApi } from "~/trpc/vanilla";

interface TagItem {
  id: string;
  name: string;
  count: number;
}

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
 *  "＋ 标签" menu and in the library's model filter. */
export function ModelTagManager({ initialTags, onChanged, onClose }: ModelTagManagerProps) {
  // Seed local list with the parent's snapshot on first mount, then defer to
  // our own /api/workflow-models fetch (refresh on mount) — the parent's
  // snapshot can be older than ours, so we must not overwrite a fresher local
  // list with a stale prop value.
  const [tags, setTags] = useState<TagItem[]>(initialTags);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Sync from props ONLY when the parent hands us a strictly bigger list —
  // never overwrite a fresher local list with a stale prop snapshot, or
  // newly created tags would briefly disappear between create() and refresh().
  useEffect(() => {
    if (initialTags.length > 0) {
      setTags((prev) => {
        const prevNames = new Set(prev.map((t) => t.name));
        const newOnes = initialTags.filter((t) => !prevNames.has(t.name));
        return newOnes.length > 0 ? [...newOnes, ...prev] : prev;
      });
    }
  }, [initialTags]);

  const refresh = useCallback(async () => {
    try {
      const d = await vanillaApi.workflowModel.list.query();
      if (Array.isArray(d.tags)) setTags(d.tags as TagItem[]);
    } catch {
      /* ignore — list may be stale but the dialog stays usable */
    }
  }, []);

  const addTag = useCallback(async () => {
    const name = draft.trim();
    if (!name) return;
    setBusy(true);
    setError("");
    try {
      const d = await vanillaApi.workflowModel.create.mutate({ name });
      if (!d.tag) {
        setError("添加失败");
        return;
      }
      setDraft("");
      await refresh();
      onChanged();
    } catch (e: any) {
      setError(e?.message ?? "添加失败");
    } finally {
      setBusy(false);
    }
  }, [draft, refresh, onChanged]);

  const deleteTag = useCallback(
    async (name: string, count: number) => {
      // 二次确认：标签若仍绑定到工作流，删除会一并解除所有绑定，避免误删。
      if (count > 0) {
        const ok = window.confirm(
          `该标签「${name}」已绑定 ${count} 个工作流。\n删除后这些工作流将一并解除绑定，且不可撤销。\n\n确定要继续吗？`,
        );
        if (!ok) return;
      }
      try {
        const d = await vanillaApi.workflowModel.delete.mutate({ name });
        if (!d.ok) {
          setError("删除失败");
          return;
        }
        await refresh();
        onChanged();
      } catch (e: any) {
        setError(e?.message ?? "删除失败");
      }
    },
    [refresh, onChanged],
  );

  /** PATCH /api/workflow-models → rename a tag in place.  The join rows are
   *  keyed by tag id, so every workflow that referenced the old name
   *  automatically picks up the new name — no extra rewiring needed.
   *  After success, locally swap the row's name in `tags` so the dialog
   *  reflects the rename immediately without waiting for the parent's
   *  refresh round-trip (avoids a visible "stale then snap" flicker), and
   *  close the editor (the caller passes onCloseEdit so we can centrally
   *  clear editingId without leaking state out of this callback's closure).
   *  Returns true on success. */
  const renameTag = useCallback(
    async (oldName: string, newName: string, onCloseEdit?: () => void) => {
      const trimmed = newName.trim();
      if (!trimmed || trimmed === oldName) {
        // Same name (or empty) — treat as no-op success and close the editor.
        onCloseEdit?.();
        return true;
      }
      try {
        const d = await vanillaApi.workflowModel.rename.mutate({
          oldName,
          newName: trimmed,
        });
        if (!d.tag) {
          setError("重命名失败");
          return false;
        }
        setError("");
        // Locally swap the row name so the dialog reflects the rename now,
        // even before the parent's `onChanged → loadModelTags` round-trip.
        setTags((prev) => prev.map((t) => (t.name === oldName ? { ...t, name: trimmed } : t)));
        await refresh();
        onChanged();
        onCloseEdit?.(); // close the editor AFTER state is consistent
        return true;
      } catch (e: any) {
        setError(e?.message ?? "重命名失败");
        return false;
      }
    },
    [refresh, onChanged],
  );

  // ── Inline-rename state ─────────────────────────────────────────────────
  // Only one tag is editable at a time. `editingId=null` means all rows are
  // in their default (read-only) state with a "double-click to rename" hint.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const beginEdit = useCallback((id: string, currentName: string) => {
    setEditingId(id);
    setEditingDraft(currentName);
    setError("");
  }, []);
  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditingDraft("");
  }, []);
  const commitEdit = useCallback(
    (id: string, oldName: string) => {
      void renameTag(oldName, editingDraft, () => cancelEdit());
    },
    [renameTag, editingDraft, cancelEdit],
  );

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 bg-[#15151C] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="管理模型标签"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-semibold text-gray-100">
            <Icon name="tag" className="h-4 w-4 text-fuchsia-300" />
            模型标签库
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-white/5 hover:text-gray-200"
            aria-label="关闭"
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-3 text-xs leading-relaxed text-gray-400">
          这些标签是<strong className="text-gray-200">用户级全局库</strong>，可跨多个工作流复用。
          在这里新增/删除后，即可在工作流卡片上「＋ 标签」绑定，并在上方按模型筛选。
        </p>

        <div className="mb-4 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void addTag();
            }}
            placeholder="新增模型名，如 z-image / wan2.2"
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-gray-100 outline-none placeholder:text-gray-500 focus:border-fuchsia-500/50"
          />
          <button
            type="button"
            onClick={() => void addTag()}
            disabled={busy || !draft.trim()}
            className="rounded-lg bg-fuchsia-500/90 px-3 py-2 text-sm font-semibold text-white hover:bg-fuchsia-500 disabled:opacity-50"
          >
            {busy ? "…" : "添加"}
          </button>
        </div>

        {error && <div className="mb-3 text-xs text-red-400">{error}</div>}

        <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-1">
          {tags.length === 0 && (
            <div className="py-6 text-center text-sm text-gray-500">还没有模型标签</div>
          )}
          {tags.map((t) => {
            const isEditing = editingId === t.id;
            return (
              <div
                key={t.id}
                className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2"
              >
                {isEditing ? (
                  <input
                    autoFocus
                    value={editingDraft}
                    maxLength={64}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setEditingDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void commitEdit(t.id, t.name);
                      } else if (e.key === "Escape") {
                        e.preventDefault();
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
                    className="min-w-0 flex-1 rounded-md border border-fuchsia-500/50 bg-black/30 px-2 py-0.5 text-sm text-gray-100 outline-none focus:border-fuchsia-400"
                  />
                ) : (
                  <span
                    onDoubleClick={() => beginEdit(t.id, t.name)}
                    title="双击重命名"
                    className="cursor-text select-none truncate rounded-sm px-0.5 text-sm text-gray-200 hover:bg-white/5 hover:text-gray-100"
                  >
                    {t.name}
                  </span>
                )}
                <div className="flex shrink-0 items-center gap-2">
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] tabular-nums text-gray-400">
                    {t.count} 个工作流
                  </span>
                  <button
                    type="button"
                    onClick={() => void deleteTag(t.name, t.count)}
                    disabled={isEditing}
                    title={t.count > 0 ? `删除「${t.name}」，会一并解除 ${t.count} 个工作流的绑定` : `删除「${t.name}」`}
                    className="rounded-md border border-transparent p-1 text-gray-400 hover:border-red-400/40 hover:bg-red-500/15 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={`删除 ${t.name}`}
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
