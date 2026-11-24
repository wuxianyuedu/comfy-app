"use client";

// ── 测试模型树形菜单的取数装配（ISSUE #4916）────────────────────────────
// 三种用途各接一份 useTestCatalog（configGet / 工作流清单 / 模式契约的
// queryKey 相同，React Query 自动去重，不产生额外网络请求；适配器按候选名
// fetchQuery，同名也只取一次），再把每份候选按「支持哪些模式」展开成树条目
// （展开口径在 model-test-tree.ts 纯函数）。视图层不出现 fetch / api.*。

import { useMemo } from "react";

import { useTRPC } from "~/trpc/react";

import { defaultModeForKind } from "../model-test-config";
import { modelTreeEntriesForKind, type ModelTreeEntry } from "../model-test-tree";
import { useTestCatalog } from "./use-model-test";

export type ModelTestTreeCatalog = {
  /** 全部用途的树条目（每条 = 某用途下某模式可测的一个候选）。 */
  entries: Array<ModelTreeEntry>;
  /** 取值 → 显示名（触发器与叶子共用；同一取值多模式时同名）。 */
  labels: Record<string, string>;
  /** 候选取数的加载态（与测试页同一批查询）。 */
  loading: boolean;
};

export function useModelTestTree(): ModelTestTreeCatalog {
  const trpc = useTRPC();
  /* 固定三次调用（用途是常量元组、顺序稳定，不违反 hook 规则）。mode 传
   * 各用途默认值即可 —— 树只吃 candidates / adaptersByModel，不消费按模式
   * 收窄后的结果。 */
  const image = useTestCatalog({
    kind: "image",
    mode: defaultModeForKind("image"),
    selectedModel: "",
    trpc,
  });
  const video = useTestCatalog({
    kind: "video",
    mode: defaultModeForKind("video"),
    selectedModel: "",
    trpc,
  });
  const chat = useTestCatalog({ kind: "chat", mode: "", selectedModel: "", trpc });

  const entries = useMemo(
    () => [
      ...modelTreeEntriesForKind({
        adaptersByModel: image.adaptersByModel,
        candidates: image.candidates,
        kind: "image",
      }),
      ...modelTreeEntriesForKind({
        adaptersByModel: video.adaptersByModel,
        candidates: video.candidates,
        kind: "video",
      }),
      ...modelTreeEntriesForKind({
        adaptersByModel: chat.adaptersByModel,
        candidates: chat.candidates,
        kind: "chat",
      }),
    ],
    [
      image.adaptersByModel,
      image.candidates,
      video.adaptersByModel,
      video.candidates,
      chat.adaptersByModel,
      chat.candidates,
    ],
  );

  const labels = useMemo(() => {
    const out: Record<string, string> = {};
    for (const entry of entries) {
      out[entry.value] ??= entry.label;
    }
    return out;
  }, [entries]);

  return { entries, labels, loading: image.loading || video.loading || chat.loading };
}
