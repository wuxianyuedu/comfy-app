"use client";

// ── 「给一屏里的**某一条**跑一次异步动作」的唯一出口（规范 16 §16.2.4.40）─────
//
// 按形态扫描时撞出来的账：「一条目一按钮、点下去只忙那一条」这段执行态
// 在全库有四处各写一遍，写法看着都对，**语义却各判各的**：
//
//   ① `use-history-list` 的 `retryingId` —— 重试任务
//   ② `CharacterDesigner` 的 `aiBusyId` —— 单个角色的 AI 润色
//   ③ `useStoryboardPlanner` 的 `polishBusyId` —— 单个镜头的提示词润色
//   ④ `CanvasNode/use-generate` 的 `retryGenerate` —— 节点按上次 payload 重跑
//
// 差别不在「忙标记怎么写」（那一眼就看得出），而在三个**语义决定**上：
//
//   · **忙的那一条是怎么判的** —— 四处都在视图里写 `busyId === item.id`
//     （`HistoryList` / `StoryboardPlanner` / `CharacterDesigner` 各一遍），
//     于是「这个按钮该不该禁用」这条判据也散在四处；
//   · **失败之后忙标记怎么落** —— 三处走 `finally`，一处（画布节点）
//     把状态写进节点 data，卸载后仍会 `patch`（它是 store，不是组件 state，
//     这一处**刻意**不进本出口，理由见下）；
//   · **同一条能不能重复点** —— `setBusyId(id)` 是**异步**落状态，同一次事件
//     循环里连点两下时读 `busyId` 还是旧值 —— 四处**没有一处**防了这个
//     （与 §16.2.4.25 的 `useExternalAction` 是同一个坑：
//     那里的 `busy` 用同步 ref 判重入，这里同样用 ref）。
//
// 也就是说 —— **「点了这一条之后，其它条目还能不能点、忙标记什么时候落」
// 取决于它是哪一处写的**。这类差异没有报错、没有告警，tsc / eslint 也都不看
// （`useState<string | null>` 是到处都在用的合法写法）。
//
// ## 与 `~/lib/async-action` / `~/components/ui/use-item-errors` 的分工
//
// 三者是同一件事的三段，配合使用、不互相替代：
//
// | 出口 | 回答的问题 |
// | ---- | ---------- |
// | `use-item-errors` | 这句话**挂在谁身上**（键 → 文案） |
// | `useItemAction`  | **哪一条在忙**（键 → 忙）、忙时怎么禁用、同一条能不能重复点 |
// | `runAsyncAction`  | 这次动作**说什么**（成功 / 失败文案与通道） |
//
// 本出口**不**接管 `runAsyncAction`：它是「编排」而不是「状态」，
// 而四处落点的失败通道各不相同（行内错误条 / toast / 节点 data），
// 由调用处按 §16.2.4.30 的口径注入。
//
// ## 刻意不收的那一处
//
// `CanvasNode/use-generate` 的 `retryGenerate` **不进本出口**：它的状态写进
// 节点 data（`patch({ status: "running", … })`），那是**画布上持久化的节点相位**，
// 不是「这一刻哪一条在忙」的界面执行态 —— 节点卸载 / 重挂后相位要留着，
// 而 `useItemAction` 的忙标记随组件卸载消失。两者形态相近、语义不同，
// 硬合并会把「节点死后还显示运行中」这条既有语义弄丢。

import { useCallback, useMemo, useRef, useState } from "react";

export type ItemActionScope = string | null;

export interface ItemAction {
  /** 当前在忙的那一条（`null` = 没有动作在跑）。 */
  busyId: ItemActionScope;
  /** 读取用的判据：`busyId === id`（视图里不再自己写这个比较）。 */
  isBusy: (id: ItemActionScope) => boolean;
  /** 是否**有任何**动作在跑（决定「全部重试」这类整表动作能不能点）。 */
  anyBusy: boolean;
  /**
   * 跑一次**针对某一条**的动作。
   *
   * - 忙标记在**开始前**落下、`finally` 里清掉（无论成功 / 抛异常）；
   * - **同一条重复点直接忽略**（用同步 `ref` 判 —— `busyId` 是异步落状态的，
   *   同一次事件循环里连点两下读不出来，那正是「双击发两次请求」的成因）；
   * - **不同条之间不互斥**：调用处想互斥时看 `anyBusy` 禁用**别的**条目
   *   （「一条在跑时不让开第二条」是调用处的域判据，不是本出口的）。
   *
   * 返回 `action` 的返回值；被重复点忽略时返回 `undefined` ——
   * 调用处本来也不会去读它（那条路根本不发请求）。
   */
  run: <T>(
    id: ItemActionScope,
    action: () => Promise<T>,
  ) => Promise<T | undefined>;
  /** 手动清忙标记（如动作被外部取消）。正常路径不必调。 */
  clear: () => void;
}

/**
 * 「一屏多条目、一次只忙一条」的执行态。
 *
 * 传 `keys` 会**收敛生命周期**：条目被删掉后它的忙标记随之消失
 * （与 `useItemErrors` 的 `keys` 同款，规范 §16.2.4.33）——
 * 否则删掉一条正在跑的条目会留下一个指向不存在条目的忙标记，
 * 而它会让 `anyBusy` 永远为真（整表动作再也点不动）。
 */
export function useItemAction(keys?: readonly string[]): ItemAction {
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
    async <T>(
      id: ItemActionScope,
      action: () => Promise<T>,
    ): Promise<T | undefined> => {
      const key = scopeKey(id);
      /* 同一条重复点：直接忽略（不发第二次请求，也不动忙标记）。 */
      if (runningRef.current.has(key)) return undefined;
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

  const clear = useCallback(() => setBusyId(null), []);

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
