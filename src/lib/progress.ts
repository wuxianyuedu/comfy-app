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

import { clamp } from "~/lib/clamp";
import { asRecord } from "~/lib/is-record";
import { fixed } from "~/lib/number-format";

/** 上限。进度条的天然量纲是百分比。 */
export const PROGRESS_MAX = 100;

/**
 * 夹取到 `[0, 100]` 的整数百分比。
 *
 * 非有限数（`NaN` / `±Infinity`）返回 **0**（此处是「确定的值」语义；
 * 要「不确定」请用 `toPct` / `ProgressBar` 的 `value={null}`）。
 */
export function clampPct(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return clamp(Math.round(value), 0, PROGRESS_MAX);
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
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) {
    return null;
  }
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
export function pctToWidth(pct: number | null, options: { minVisible?: number } = {}): number {
  if (pct === null) {
    return 0;
  }
  const clamped = clampPct(pct);
  if (clamped === 0) {
    return 0;
  }
  const minVisible = options.minVisible ?? 0;
  return clamp(minVisible, clamped, PROGRESS_MAX);
}

// ── 采样进度的人类可读描述（生图进行时进度条上的那几行）────────────
//
// ComfyUI 的 progress 帧经 executor-ws / executor-cli-stream 落库为两样：
// `progress`（0~100 百分比）与 `progressNode` JSON（`{id, value, max, …}`，
// value/max 即采样步数）。这里把它们与开始时刻合成用户要读的四件事：
// 步数（553/8196）、已用（00:42）、预估剩余（10:07）、速度（12.58 it/s）——
// 与 ComfyUI 控制台的 tqdm 行 `7%|▋| 553/8196 [00:42<10:07, 12.58it/s]`
// 是同一套信息；速度取「平均速率」（总步数 ÷ 总耗时），tqdm 显示的是
// 平滑瞬时值，两者口径不同、都对，这里选平均是因为它不需要维护状态。

/** 已运行毫秒 → `mm:ss`；满一小时进位 `h:mm:ss`。时长展示的唯一实现。 */
export function formatDurationMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const ss = String(total % 60).padStart(2, "0");
  const mm = String(Math.floor(total / 60) % 60).padStart(2, "0");
  const h = Math.floor(total / 3600);
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * 由「已耗时 + 百分比」线性外推剩余毫秒。
 * 0% / 100% / 非有限输入给 `null` —— 剩余时间在两端没有意义：
 * 0% 还没起步（斜率未知），100% 已经收尾（不再剩）。负结果夹到 0。
 */
export function estimateRemainingMsFrom(elapsedMs: number, pct: number): number | null {
  if (!Number.isFinite(elapsedMs) || pct <= 0 || pct >= 100) {
    return null;
  }
  const total = elapsedMs / (pct / 100);
  return Math.max(0, Math.round(total - elapsedMs));
}

/** 步数文案 `553/8196`；任一侧不可用（null / 非有限 / max≤0 / value<0）给 `null`，不显示假步数。 */
export function formatStepsText(value: number | null, max: number | null): string | null {
  if (
    value === null ||
    max === null ||
    !Number.isFinite(value) ||
    !Number.isFinite(max) ||
    max <= 0 ||
    value < 0
  ) {
    return null;
  }
  return `${Math.round(value)}/${Math.round(max)}`;
}

/** 平均速度 `12.58 it/s`（步数 ÷ 秒）；任一项不可用给 `null`。 */
export function formatSampleRateText(
  value: number | null,
  elapsedMs: number | null,
): string | null {
  if (
    value === null ||
    elapsedMs === null ||
    !Number.isFinite(value) ||
    !Number.isFinite(elapsedMs) ||
    value <= 0 ||
    elapsedMs <= 0
  ) {
    return null;
  }
  /* 速率在此必为有限数（上面已挡），`fixed` 的 null 分支走不到 —— 兜底串只为类型收口。 */
  return `${fixed(value / (elapsedMs / 1000), 2) ?? "0.00"} it/s`;
}

/**
 * `Task.progressNode` JSON → 采样步数。
 * 形状由 executor-ws 的 progress 分支写入（`{id, value, max, …}`）；
 * 列里存了别的东西 / 旧行为 null 时两个字段都是 `null`，调用方按
 * 「拿不到」降级，不猜数。
 */
export function readProgressNodeSteps(raw: unknown): { max: number | null; value: number | null } {
  const rec = asRecord(raw);
  if (rec === null) {
    return { max: null, value: null };
  }
  const toNum = (v: unknown): number | null => {
    const n =
      typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
    return Number.isFinite(n) ? n : null;
  };
  return { max: toNum(rec.max), value: toNum(rec.value) };
}

/** 一次进度观测：百分比 + 步数 + 开始时刻（画布轮询与状态栏聚合共用这一形状）。 */
export type SampleProgressSnapshot = {
  /** 总步数（progressNode.max）；拿不到为 null。 */
  max: number | null;
  /** 0~100，确定值语义（落库前已夹取）。 */
  pct: number;
  /** 开始时刻（epoch ms，取 claimedAt，旧行退化 createdAt）；拿不到为 null。 */
  startedAtMs: number | null;
  /** 已完成步数（progressNode.value）；拿不到为 null。 */
  value: number | null;
};

/** `describeSampleProgress` 的产出：进度条上各行的**文字**，视图只渲染不算数。 */
export type SampleProgressText = {
  /** 已用（`00:42`）；没有开始时刻为 null。 */
  elapsedText: string | null;
  /** 预估剩余（`10:07`）；算不出为 null（调用方写「估算中」或不显示）。 */
  etaText: string | null;
  /** 0~100 已夹取。 */
  pct: number;
  /** 平均速度（`12.58 it/s`）；算不出为 null。 */
  rateText: string | null;
  /** 步数（`553/8196`）；拿不到为 null。 */
  stepsText: string | null;
};

/** 一次观测 → 进度条各行的文字。纯函数：`nowMs` 显式传入，测试不依赖真实时钟。 */
export function describeSampleProgress(
  snap: SampleProgressSnapshot,
  nowMs: number,
): SampleProgressText {
  const elapsedMs = snap.startedAtMs === null ? null : Math.max(0, nowMs - snap.startedAtMs);
  const remainingMs = elapsedMs === null ? null : estimateRemainingMsFrom(elapsedMs, snap.pct);
  return {
    pct: clampPct(snap.pct),
    stepsText: formatStepsText(snap.value, snap.max),
    rateText: formatSampleRateText(snap.value, elapsedMs),
    elapsedText: elapsedMs === null ? null : formatDurationMs(elapsedMs),
    etaText: remainingMs === null ? null : formatDurationMs(remainingMs),
  };
}
