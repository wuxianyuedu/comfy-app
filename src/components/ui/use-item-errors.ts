"use client";

// ── 「每一条各自挂错误」的唯一出口（规范 16 §16.2.4.33）──────────────────────
//
// 按形态扫描时撞出来的账：`use-model-tags` / `use-training-studio` 这类
// **一屏多条目**的逻辑层，错误状态写的是 `useState<string | null>(null)` ——
// 也就是「最近一次操作的草稿」：
//
//   新增失败 → 错误条出现 → 用户改删另一条 → 错误条被**同一块**覆盖，
//   而上一条那行已经不再标红（提示说的是哪一条，只能靠用户自己回忆）。
//
// 差别不是「谁写得好看」，而是**错误的生命周期**：
//
//   · 「最近一次操作的草稿」= 下一条消息必然把它盖掉（时间维度的状态）；
//   · 「按条目挂」= 错误属于**那一条**，改别处不该动它（对象维度的状态）。
//
// 两者在代码上长得几乎一样（都是 `setError(string)` + 一块行内错误条），
// 所以这类差异没有报错、没有告警，tsc / eslint 也都不看。
//
// ## 收什么、不收什么
//
// **收**：错误挂在哪个 scope 上（`key`）、一条 / 全部怎么读、
// 成功时清哪一条、一次操作无对应条目时往哪放（无 key 那档）。
// **不收**：错误文案怎么来（归 `~/lib/async-action` 的 `errorMessage`）、
// 错误条长什么样（归 `~/components/ui/alert`）、要不要让用户重试
// （那是调用处的域判据）。
//
// ## 与 `~/lib/async-action` 的分工
//
// `runAsyncAction` 的 `report(kind, detail)` 回答的是「这次动作**说什么**」；
// 本出口回答的是「这句话**挂在谁身上**」。两者配合的形态见
// `use-model-tags`：`report` 接 `errors.report(key)`，一次动作一个 key。

import { useCallback, useMemo, useState } from "react";

/** 一次动作的 scope：`null` 表示「不属于任何一条」（整表级别的错误）。 */
export type ErrorScope = string | null;

export interface ItemErrors {
  /**
   * 取某一条的错误文案；没有则该条不标红。
   *
   * `null` 与「没有这个 key」是同一件事（这条没出错），调用处不必区分。
   */
  get: (key: ErrorScope) => string | null;
  /** 是否有任何错误（决定要不要渲染错误条容器）。 */
  hasAny: boolean;
  /**
   * 反馈通道：接给 `runAsyncAction` 的 `report`。
   *
   * 用法是 `report: errors.report(tag.id)` —— **一次动作一个 key**。
   * 成功时清掉该条的错误（重试成功后不该还挂着上一次的文案），
   * 同时清掉无 key 那档（整表错误在任一条成功后即失效）。
   */
  report: (key: ErrorScope) => (kind: "ok" | "err", detail: string) => void;
  /** 手动清掉某一条（如用户重新打开该行的编辑器）。 */
  clear: (key: ErrorScope) => void;
  /** 清掉全部（如整表刷新 / 关闭弹窗）。 */
  clearAll: () => void;
}

/**
 * 按条目挂错误的错误表。
 *
 * `keys` 用来**收敛生命周期**：它给出「当前屏幕上真正存在的条目」，
 * 被删掉的那条的错误会随之消失 —— 否则删掉一条失败后留下一个
 * 指向已不存在条目的错误条，用户找不到它说的是什么。
 *
 * 传 `undefined` 表示「条目集合不固定」（如新增框：新增前还没有这一条），
 * 这时不做收敛，错误靠 `clear` / `clearAll` 显式清。
 */
export function useItemErrors(keys?: readonly string[]): ItemErrors {
  const [errors, setErrors] = useState<Record<string, string>>({});

  /* key 集合的内容指纹 —— 按**内容**比较而非数组引用：调用处几乎都是
   * `tags.map(t => t.id)`，每次渲染都是新数组，按引用比较会每次都 setState
   * （与 `use-model-tags` 的快照合并同款，规范 §16.2.4.16）。 */
  const keyPrint = keys === undefined ? null : keys.join("\u0000");

  const visible = useMemo(() => {
    if (keyPrint === null) return errors;
    const allow = new Set(keyPrint === "" ? [] : keyPrint.split("\u0000"));
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(errors)) {
      /* 无 key 那档（整表错误）不受收敛影响：它的作用域本来就是整块。 */
      if (k === SCOPE_NONE || allow.has(k)) out[k] = v;
    }
    return out;
    /* `errors` 进依赖；`keyPrint` 是它的过滤器，故一并列出。 */
  }, [errors, keyPrint]);

  const set = useCallback((key: ErrorScope, detail: string | null) => {
    const bucket = scopeKey(key);
    setErrors((prev) => {
      /* 清一条时若它本来就没错，返回原引用 —— 这个函数会被挂在 effect /
       * 回调里调用，多一次引用变化就多一次级联渲染。 */
      if (detail === null && !(bucket in prev)) return prev;
      const next = { ...prev };
      if (detail === null) delete next[bucket];
      else next[bucket] = detail;
      return next;
    });
  }, []);

  const report = useCallback(
    (key: ErrorScope) => (kind: "ok" | "err", detail: string) => {
      if (kind === "err") {
        set(key, detail);
        return;
      }
      /* 成功即清：该条的错误与整表错误都失效（重试成功不该还挂着旧文案）。 */
      set(key, null);
      set(null, null);
    },
    [set],
  );

  const clear = useCallback((key: ErrorScope) => set(key, null), [set]);

  const clearAll = useCallback(() => {
    setErrors((prev) => (Object.keys(prev).length === 0 ? prev : {}));
  }, []);

  const get = useCallback(
    (key: ErrorScope) => visible[scopeKey(key)] ?? null,
    [visible],
  );

  return useMemo(
    () => ({
      get,
      hasAny: Object.keys(visible).length > 0,
      report,
      clear,
      clearAll,
    }),
    [get, visible, report, clear, clearAll],
  );
}

/** 表内部的键：`null` 换成哨兵 —— `Record` 的键只能是字符串。 */
const SCOPE_NONE = "\u0000__none__";
function scopeKey(key: ErrorScope): string {
  return key ?? SCOPE_NONE;
}
