"use client";

// ── 模型标签库：逻辑层（规范 17 §17.2 第②层）────────────────────────────────
// 承载标签列表的 props 合并、新增/删除/重命名与错误提示。
// ModelTagManager 视图只消费本 hook，不再出现 vanillaApi。
//
// props 合并规则（原组件的隐式契约，此处显式化）：
//   父组件传来的 initialTags 是缓存快照，可能比本地列表旧 —— 只在能带来
//   「本地没有的新标签」时才并入，绝不拿旧快照覆盖本地（否则新建的标签会在
//   create() 与 refresh() 之间闪一下就消失）。

import { useCallback, useState } from "react";

import { errorMessage } from "~/lib/error-message";
import { vanillaApi } from "~/trpc/vanilla";

/** 快照去重 key 的分隔符：标签名不含 \u0000，用它拼不会撞车。 */
const SNAPSHOT_KEY_SEP = "\u0000";

export interface TagItem {
  id: string;
  name: string;
  count: number;
}

export interface ModelTagsController {
  tags: TagItem[];
  /** 新增框草稿。 */
  draft: string;
  setDraft: (value: string) => void;
  busy: boolean;
  /** 最近一次操作的错误文案；null 表示无错误。 */
  error: string | null;
  addTag: () => Promise<void>;
  /** 删除：count>0 时先弹二次确认（删掉会一并解除工作流绑定）。 */
  deleteTag: (name: string, count: number) => Promise<void>;
  /**
   * 重命名。成功后本地立即改名（不等父组件刷新，避免「旧名闪一下」），
   * 返回 true 表示成功——调用方据此关闭内联编辑器。
   */
  renameTag: (oldName: string, newName: string) => Promise<boolean>;
}

/** 把父组件的快照并入本地列表：只补本地没有的，不覆盖已有的。 */
export function mergeTagSnapshots(local: TagItem[], snapshot: TagItem[]): TagItem[] {
  const localNames = new Set(local.map((tag) => tag.name));
  const fresh = snapshot.filter((tag) => !localNames.has(tag.name));
  return fresh.length > 0 ? [...fresh, ...local] : local;
}

export interface UseModelTagsOptions {
  /** 父组件的缓存快照（首次渲染的种子值）。 */
  initialTags: TagItem[];
  /** 任一写操作成功后回调，让父组件刷新自己的列表。 */
  onChanged?: () => void;
}

export function useModelTags({
  initialTags,
  onChanged,
}: UseModelTagsOptions): ModelTagsController {
  const [tags, setTags] = useState<TagItem[]>(initialTags);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* 只在父组件递来「带了新标签」的快照时才并入——合并规则见文件头。
   *
   * 判据用**内容**而非数组引用：父组件若写成 `initialTags={tags?.data ?? []}`
   * （每次渲染都是新数组），按引用比较会每次都 setState → 「Too many re-renders」。
   * 用名称集合做 key，引用变、内容没变就什么都不做。
   *
   * 上一个 key 存在 state 里而不是 ref：`react-hooks/refs` 禁止在渲染期读写 ref，
   * 而 React 19 的「渲染期调整 state」范式本就要求把前值放 state（放 ref 属于
   * 渲染期副作用，会让组件在并发渲染下丢更新）。 */
  const [prevSnapshotKey, setPrevSnapshotKey] = useState(() =>
    initialTags.map((tag) => tag.name).join(SNAPSHOT_KEY_SEP),
  );
  const snapshotKey = initialTags.map((tag) => tag.name).join(SNAPSHOT_KEY_SEP);
  if (snapshotKey !== prevSnapshotKey && initialTags.length > 0) {
    setPrevSnapshotKey(snapshotKey);
    setTags((prev) => mergeTagSnapshots(prev, initialTags));
  }

  const refresh = useCallback(async () => {
    try {
      const d = await vanillaApi.workflowModel.list.query();
      if (Array.isArray(d.tags)) setTags(d.tags);
    } catch {
      /* 拉取失败保留旧列表，弹窗仍可用 */
    }
  }, []);

  const addTag = useCallback(async () => {
    const name = draft.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const d = await vanillaApi.workflowModel.create.mutate({ name });
      if (!d.tag) {
        setError("添加失败");
        return;
      }
      setDraft("");
      await refresh();
      onChanged?.();
    } catch (e) {
      setError(errorMessage(e, "添加失败"));
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
        onChanged?.();
      } catch (e) {
        setError(errorMessage(e, "删除失败"));
      }
    },
    [refresh, onChanged],
  );

  const renameTag = useCallback(
    async (oldName: string, newName: string): Promise<boolean> => {
      const trimmed = newName.trim();
      // 同名或空名视为 no-op 成功：调用方直接关闭编辑器（原组件行为）。
      if (!trimmed || trimmed === oldName) return true;
      try {
        const d = await vanillaApi.workflowModel.rename.mutate({
          oldName,
          newName: trimmed,
        });
        if (!d.tag) {
          setError("重命名失败");
          return false;
        }
        setError(null);
        // 本地先换名，让弹窗立刻反映重命名，不等父组件 onChanged 的往返。
        setTags((prev) =>
          prev.map((tag) => (tag.name === oldName ? { ...tag, name: trimmed } : tag)),
        );
        await refresh();
        onChanged?.();
        return true;
      } catch (e) {
        setError(errorMessage(e, "重命名失败"));
        return false;
      }
    },
    [refresh, onChanged],
  );

  return { tags, draft, setDraft, busy, error, addTag, deleteTag, renameTag };
}
