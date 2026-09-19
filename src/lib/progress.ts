// ── 「异步动作的进度」的唯一出口（数值侧）（规范 16 §16.2.4.19）────────────
//
// 此前全库有 10 处各写一遍「把某个数变成一个进度条的宽度」，而写法分四派：
//   · `Math.max(4, p)`（工坊三处 + 工作流封装测试）—— 一个**下限**，
//     让 0% 时那一格仍看得见；另外六处都没有，0% 时条子是空的
//   · `Math.min(100, (done / total) * 100)`（自定义节点设置）—— 自己算比例
//   · 直接 `${x}%`（历史卡 / 影片 / 训练）—— 不夹取，接口给 120 就溢出
//   · `${pct}%` 且上一步的 pct 已经 `Math.round`
//
// 与 `display-value` / `list-filter` 同款：这条账的形状是**口径**，不是组件。
// `Math.max(4, p)` 与 `p` 都编译、都运行、类型都对，差别只在「0% 要不要看得见」
// 这一个语义决定上 —— 散在 10 处就永远不会被统一说出来。
//
// 口径（本文件是全库唯一的定义处）：
//   · **不做下限**。0% 就是 0 宽。想要下限的域显式传 `minVisible`
//     —— 「0% 也留一格」是个别面板的观感选择，不该变成全库默认
//   · **夹取到 [0, 100]**。接口/SSE 给的数不可信（`-1` 会让宽度负，
//     `120` 会溢出容器）；夹取放出口里，调用处不必逐个记
//   · **非有限数（NaN / Infinity）→ `null`**（= 不确定），而不是 0
//     —— 「算不出来」与「进度是 0」是两件事，前者该给不确定态
//
// 渲染侧（track + fill + 百分比文字）的唯一出口是
// `~/components/ui/progress` 的 `ProgressBar` —— 本文件只管**数值怎么算**。

/** 上限。进度条的天然量纲是百分比。 */
export const PROGRESS_MAX = 100;

/**
 * 夹取到 `[0, 100]` 的整数百分比。
 *
 * 非有限数（`NaN` / `±Infinity`）返回 **0**（此处是「确定的值」语义；
 * 要「不确定」请用 `toPct` / `ProgressBar` 的 `value={null}`）。
 */
export function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(PROGRESS_MAX, Math.max(0, Math.round(value)));
}

/**
 * 「已完成 / 总量」→ 百分比。
 *
 * 以下三种情况返回 **`null`（= 不确定）**，因为它们都不是「进度是 0」：
 *   · `total` ≤ 0 或非有限 —— 分母不可用（总数还没算出来）
 *   · `done` 非有限 —— 分子不可用
 *   · 尚未开始且总量未知的初态
 *
 * ```ts
 * toPct(3, 10)   // 30
 * toPct(0, 10)   // 0    （确实还没开始，但总量已知）
 * toPct(3, 0)    // null （总量未知 → 不确定态）
 * ```
 *
 * 需要「下限可见宽度」时，把结果交给 `ProgressBar` 的 `minVisible`。
 */
export function toPct(done: number, total: number): number | null {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0)
    return null;
  return clampPct((done / total) * PROGRESS_MAX);
}

/**
 * 进度百分比 → 宽度样式值，可选**下限可见宽度**。
 *
 * `minVisible` 是「0 < pct < minVisible 时抬到 minVisible」，**0 仍为 0**
 * —— 这与此前 `Math.max(4, p)` 的差别正是本出口要统一的那一条：
 * 那个写法会把「没开始（0）」也画成 4% 宽，看起来像跑了 4%。
 *
 * ```ts
 * pctToWidth(0)                 // 0    （没开始就是没开始）
 * pctToWidth(1, { minVisible: 4 }) // 4 （刚开始，给一格让用户看见）
 * pctToWidth(50, { minVisible: 4 })// 50
 * ```
 */
export function pctToWidth(
  pct: number | null,
  options: { minVisible?: number } = {},
): number {
  if (pct === null) return 0;
  const clamped = clampPct(pct);
  if (clamped === 0) return 0;
  const minVisible = options.minVisible ?? 0;
  return Math.max(clamped, Math.min(PROGRESS_MAX, minVisible));
}
