"use client";

// ── 「一次异步动作的忙碌位」的唯一出口（规范 16 §16.2.4.71）
// 全库 40 处手写执行态分成两派：31 处于 `finally` 复位，9 处写在 `await` 之后 —— 后者只要动作抛错，忙碌位就永远停在 true，界面从此显示「正在保存…」且按钮点不动。
// 提前 `return` 的分支同样会把位留在 true（`CharacterDesigner` 的 `genBusy`、`use-history-detail-actions` 的 `downloading`）；「失败之后还能不能点」取决于它是哪一处写的。
// 与 `runAsyncAction` 分工：那个管「这次动作说什么」，本件管「这块界面忙不忙」。刻意不内置闸门（双击拦不拦由调用处决定），也不吞错；`useItemAction` 则管一屏里哪一条在忙。

import { useCallback, useEffect, useRef, useState } from "react";

/** 一次异步动作的执行态句柄。 */
export type BusyAction = {
  /** 这一刻忙不忙（给 `disabled` / 转圈 / 文案用）。 */
  busy: boolean;
  /**
   * 跑一次动作：置忙 → 跑 → 无论如何复位。已经在跑时不拦（那是 `use-reentrancy-lock` 的账）；动作抛错时忙碌位照样落下，错误原样抛给调用处（失败文案归 `~/lib/async-action`）。返回动作的返回值。
   */
  run: <T>(action: () => Promise<T>) => Promise<T>;
  /** 手动置忙 / 复位（给「分两段、中间还要等别的 promise」的落点）。 */
  set: (next: boolean) => void;
};

/**
 * 一块界面的忙碌位。三步：`const save = useBusyAction()`；把 `busy` 接到控件禁用态与文案；把动作交给 `run`（如 `onClick={() => void save.run(() => doSave())}`）。
 * 三条口径：复位判据是 `finally` 而非正常路径走完（这是本出口的全部理由）；不吞错（抛错时忙碌位落下、异常继续上抛，失败出口由调用处选）；提供 `set` 给跨多个 `await` 的分段动作，但推荐优先 `run`。
 */
export function useBusyAction(initial = false): BusyAction {
  const [busy, setBusy] = useState(initial);
  /* 卸载守卫：`finally` 里的 `setBusy(false)` 会在组件已卸载时执行
   * （动作可能跑很久，用户中途走掉）—— React 18+ 对「在已卸载组件上 setState」
   * 不再告警，但那是一次纯粹的无效调度。这里静默跳过，不改变对外的语义。 */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const set = useCallback((next: boolean) => {
    if (!mountedRef.current) {
      return;
    }
    setBusy(next);
  }, []);
  const run = useCallback(
    async <T>(action: () => Promise<T>): Promise<T> => {
      set(true);
      try {
        return await action();
      } finally {
        set(false);
      }
    },
    [set],
  );
  return { busy, run, set };
}
