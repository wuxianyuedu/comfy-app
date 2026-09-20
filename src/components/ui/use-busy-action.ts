"use client";

// ── 「一次异步动作的忙碌位」的唯一出口（规范 16 §16.2.4.71）───────────────────
//
// 按**形态**扫出来的账：全库有 40 处「先置忙碌位、跑完再复位」的手写执行态：
//
//   · 置忙 → `try { await doIt(); } finally { 复位 }` —— 该块界面的执行态。
//     （上面那个「复位」在收口前有 9 处写在 `await` **之后**的成功路径上。）
//
// 而它们对**三件事**各判各的（这三条差异都是静默的，tsc / eslint 都不看）：
//
//   ① **忙碌位几时落下** —— 31 处写在 `finally` 里（失败也落），9 处写在
//      `await` 之后的正常路径上。后者只要动作抛错，忙碌位就**永远停在 true**：
//      界面从此显示「正在保存…」，按钮再也点不动，只有刷新页面才恢复。
//      典型落点是设置页的 6 个「启动 / 关闭 / 保存」动作（它们走
//      `runAsyncAction`，而那个出口按设计**不抛错、只返回 `{ok}`** —— 于是
//      「异步动作不会抛」这个假设被当成了「不用 `finally`」的理由，
//      但 `runAsyncAction` 之外的任何一行（`await` 之后的 `setXxx`、`load()`）
//      抛出来就再也回不去了）。
//   ② **提前返回的分支落不落** —— 有的落点在参数校验失败时直接 `return`
//      （校验分支在置忙之前，没问题），有的在置忙之后还有 `return`
//      （`CharacterDesigner` 的 `genBusy`、`use-history-detail-actions` 的
//      `downloading`）—— 后面这一族在提前返回时把忙碌位留在 `true`。
//   ③ **界面用不用这个位** —— 有的只是 `disabled={busy}`，有的还要
//      「忙碌时换文案 / 转圈 / 禁用整块」，有的**根本不用**（批处理用
//      `batchRunning` 只是为了拦重入）—— 第三条是表现层选择，本出口不管。
//
// 也就是说 —— **「这个动作失败之后按钮还能不能点」取决于它是哪一处写的**。
// 这与 `~/lib/async-action`（§16.2.4.30）管的是两件事：那个出口管
// 「这次动作说什么」，本出口管「这块界面忙不忙」。
//
// ## 与相邻出口的分工
//
// | 出口 | 回答的问题 |
// | ---- | ---------- |
// | 本模块 | 这块界面**忙不忙**（一次动作的执行态，`try/finally` 一次给全） |
// | `useItemAction` | 一屏里**哪一条**在忙（按键记账） |
// | `~/components/ui/use-reentrancy-lock` | 同一时刻只跑一件（同步重入判据） |
// | `runAsyncAction` | 这次动作**说什么**（成功 / 失败文案与通道） |
//
// 四者可以并用：忙碌位给界面看、忙标记给条目看、闸门给并发看、反馈给用户看。
// 本出口**刻意不内置闸门**：「双击要不要拦」是调用处的决定（有的动作
// 双击无害、有的很贵），把它塞进忙碌位会让每个调用处都付一次 ref 的成本。

import { useCallback, useEffect, useRef, useState } from "react";

/** 一次异步动作的执行态句柄。 */
export interface BusyAction {
  /** 这一刻忙不忙（给 `disabled` / 转圈 / 文案用）。 */
  busy: boolean;
  /**
   * 跑一次动作：置忙 → 跑 → **无论如何**复位。
   *
   * 已经在跑时**不拦**（那是 `~/components/ui/use-reentrancy-lock` 的账）；动作抛错时
   * 忙碌位照样落下，错误原样抛给调用处（要不要报由它决定 —— 失败文案归
   * `~/lib/async-action`）。返回动作的返回值，调用处可以继续用。
   */
  run: <T>(action: () => Promise<T>) => Promise<T>;
  /** 手动置忙 / 复位（给「分两段、中间还要等别的 promise」的落点）。 */
  set: (next: boolean) => void;
}

/**
 * 一块界面的忙碌位。
 *
 * 用法三步：先 `const save = useBusyAction()` 拿到句柄；再把句柄的 `busy`
 * 接到控件的禁用态与文案上；最后把动作整段交给句柄的 `run` ——
 * 例如「保存」按钮的 `onClick` 写成 `void save.run(() => doSave())`，
 * 按钮文案读 `save.busy`。
 *
 * 三条刻意的口径：
 *
 * 1. **复位的判据是 `finally`，不是「正常路径走完了」** —— 这是本出口存在的
 *    全部理由（收口前 9 处把 `setBusy(false)` 写在 `await` 之后）；
 * 2. **不吞错** —— `try/finally` 没有 `catch`：动作抛错时忙碌位落下、异常继续
 *    往上走。吞掉它会让「动作失败了」这件事在调用处消失（硬规则 4：失败路径
 *    必须有可见出口，而那个出口由调用处选，不是本出口替它选一个静默）；
 * 3. **提供 `set`** —— 少数落点的忙碌位跨越多个 `await` 之间的一段
 *    （「先探测、再打开、再等结果」），那段不是单个 `action` 能表达的；
 *    但**推荐优先用 `run`**，因为它把复位绑死在 `finally` 上。
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
    if (!mountedRef.current) return;
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
