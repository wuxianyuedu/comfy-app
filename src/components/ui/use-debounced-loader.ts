"use client";

import { useEffect, useRef } from "react";

import { beginStaleRun } from "~/lib/stale-run";

/**
 * useDebouncedLoader —— 「高频输入 → 低频加载」的**加载型防抖**唯一出口（规范 16 §16.2.4.78）。
 *
 * 与 `useDebouncedValue` 并列、职责不同：后者只把**值**降频喂给纯计算 / 查询缓存，
 * 不碰加载；本出口管「防抖词落地后跑一轮加载」——值一变就作废上一轮在途请求
 * （`~/lib/stale-run` 的 `beginStaleRun`），窗口安静后才发这一轮的请求，
 * 旧轮次的 `commit`（含失败文案与 `finally` 清 loading）一律不落到界面上。
 *
 * 之所以不直接套 `useDebouncedValue` 再在外面 `beginStaleRun`：作废时机是这里的
 * 语义核心 —— 值一侧每敲一字就得丢掉上一轮请求，而防抖值的更新要等窗口结束；
 * 两层叠起来会让在途旧请求多活一个窗口、短暂闪现旧结果。所以 timer + 守卫
 * 在本出口内一次给全，外部只需给值、延迟与「这一轮怎么加载」。
 *
 * 两个差异用参数承载，不复制实现：`immediateWhen` 给「空词立即加载」那一处，
 * `deps` 给搜索词以外会重开一轮的取数维度（scope / folder / 刷新票据）。
 */
export function useDebouncedLoader<T>({
  value,
  delayMs,
  load,
  deps = [],
  immediateWhen,
}: {
  /** 防抖窗口（毫秒）。 */
  delayMs: number;
  /** 搜索词以外会重开一轮的取数依赖（scope / folder / 刷新票据等）。 */
  deps?: Array<unknown>;
  /** 命中该判据时跳过窗口、立即加载（如空搜索词立即回到全量列表）。 */
  immediateWhen?: (value: T) => boolean;
  /** 窗口安静后跑的一轮加载；`commit` 里做这一轮的写入。 */
  load: (value: T, commit: (write: () => void) => void) => void | Promise<void>;
  /** 输入值（搜索框的即时值，通常是归一化后的词）。 */
  value: T;
}): void {
  /* ref 承最新回调与判据：它们变化不重开防抖窗口，下一轮读到的仍是最新实现。
   * 在 effect 里同步（不在 render 期写），符合 react(refs)。 */
  const latest = useRef({ value, load, immediateWhen });
  useEffect(() => {
    latest.current = { value, load, immediateWhen };
  }, [value, load, immediateWhen]);

  useEffect(() => {
    const guard = beginStaleRun();
    const current = latest.current;
    const immediate = current.immediateWhen?.(current.value) ?? false;
    const timer = setTimeout(
      () => {
        if (!guard.isStale()) {
          void current.load(current.value, guard.commit);
        }
      },
      immediate ? 0 : delayMs,
    );
    return () => {
      guard.dispose();
      clearTimeout(timer);
    };
    /* deps 由调用处逐项给出，长度固定；展开进依赖数组才能让外部维度变化重开一轮。
     * value 也在依赖里：每敲一字就清旧 timer、作废旧轮次（原版逐字重排 timer 的语义）。 */
    // oxlint-disable-next-line react/exhaustive-deps
  }, [value, delayMs, ...deps]);
}
