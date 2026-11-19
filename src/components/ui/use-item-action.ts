"use client";

/** 「给一屏里的某一条跑一次异步动作」的唯一出口（规范 16 §16.2.4.40）。四处各写一遍（`use-history-list` 的 `retryingId`、`CharacterDesigner` 的 `aiBusyId`、`useStoryboardPlanner` 的 `polishBusyId`、`CanvasNode/use-generate` 的 `retryGenerate`），
 * 差别在三个语义决定：① 忙的那条怎么判（四处都在视图里写 `busyId === item.id`，禁用判据散在四处）；② 失败后忙标记怎么落（三处走 `finally`）；③ 同一条重复点（`setBusyId` 异步落状态，同一次事件循环连点读旧值，须用同步 ref 判）。
 * 与两个邻居的分工：`use-item-errors` 说「挂在谁身上」，本出口说「哪一条在忙 / 忙时怎么禁用 / 同一条能不能重复点」，`runAsyncAction` 说「这次动作说什么」。
 * 刻意不收 `CanvasNode/use-generate` 的 `retryGenerate`：它写进节点 data，是**画布上持久化的节点相位**而非「这一刻哪条在忙」，
 * 节点卸载 / 重挂后相位要留着；硬合并会把「节点死后还显示运行中」丢掉。 */

import { useCallback, useMemo, useRef, useState } from "react";

export type ItemActionScope = string | null;

export type ItemAction = {
  /** 是否**有任何**动作在跑（决定「全部重试」这类整表动作能不能点）。 */
  anyBusy: boolean;
  /** 当前在忙的那一条（`null` = 没有动作在跑）。 */
  busyId: ItemActionScope;
  /** 手动清忙标记（如动作被外部取消）。正常路径不必调。 */
  clear: () => void;
  /** 读取用的判据：`busyId === id`（视图里不再自己写这个比较）。 */
  isBusy: (id: ItemActionScope) => boolean;
  /** 跑一次**针对某一条**的动作。忙标记在**开始前**落下、`finally` 里清掉；**同一条重复点直接忽略**（用同步 ref 判 ——
   * `busyId` 异步落状态，同一次事件循环连点读不出来，正是「双击发两次请求」的成因）；**不同条之间不互斥**（要互斥时看
   * `anyBusy` 禁用别的条目，那是调用处的域判据）。返回 `action` 的返回值；被重复点忽略时返回 `undefined`。 */
  run: <T>(id: ItemActionScope, action: () => Promise<T>) => Promise<T | undefined>;
};

/**
 * 「一屏多条目、一次只忙一条」的执行态。传 `keys` 会**收敛生命周期**：条目被删后它的忙标记随之消失
 *（与 `useItemErrors` 的 `keys` 同款，规范 §16.2.4.33）—— 否则删掉一条正在跑的条目会留下指向不存在条目的
 * 忙标记，而它会让 `anyBusy` 永远为真（整表动作再也点不动）。
 */
export function useItemAction(keys?: ReadonlyArray<string>): ItemAction {
  const [busyId, setBusyId] = useState<ItemActionScope>(null);
  /* 同步的「正在跑」集合 —— `setBusyId` 是异步的，同一次事件循环里
   * 连点两下时 `busyId` 还是旧值，读它判不出重入。 */
  const runningRef = useRef<Set<string>>(new Set());

  const keyPrint = keys === undefined ? null : keys.join("\u0000");

  /* 收敛：条目集合变了就把已消失条目的忙标记丢掉（内容指纹比较，
   * 与 `useItemErrors` 同款 —— 调用处几乎都是 `items.map(i => i.id)`）。 */
  const visibleBusy =
    busyId === null || keyPrint === null
      ? busyId
      : keyPrint === ""
        ? null
        : keyPrint.split("\u0000").includes(busyId)
          ? busyId
          : null;

  const run = useCallback(
    async <T>(id: ItemActionScope, action: () => Promise<T>): Promise<T | undefined> => {
      const key = scopeKey(id);
      /* 同一条重复点：直接忽略（不发第二次请求，也不动忙标记）。 */
      if (runningRef.current.has(key)) {
        return undefined;
      }
      runningRef.current.add(key);
      setBusyId(id);
      try {
        return await action();
      } finally {
        runningRef.current.delete(key);
        setBusyId((prev) => (prev === id ? null : prev));
      }
    },
    [],
  );

  const clear = useCallback(() => {
    setBusyId(null);
  }, []);

  const isBusy = useCallback(
    (id: ItemActionScope) => visibleBusy !== null && visibleBusy === id,
    [visibleBusy],
  );

  return useMemo(
    () => ({
      busyId: visibleBusy,
      isBusy,
      anyBusy: visibleBusy !== null,
      run,
      clear,
    }),
    [visibleBusy, isBusy, run, clear],
  );
}

/** 表内部的键：`null` 换成哨兵 —— `Set` 的键只能是字符串。 */
const SCOPE_NONE = "\u0000__none__";
function scopeKey(id: ItemActionScope): string {
  return id ?? SCOPE_NONE;
}
