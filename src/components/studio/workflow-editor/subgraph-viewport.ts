/* 子工作流 / 工作流画布的「打开时聚焦」计算 —— 纯函数，无 React 依赖。
 *
 * 这套「取真实节点包围盒 → 按容器留白算 zoom → 求居中视口」的算式在子图里
 * 最容易出错，所以独立成纯函数、必须能单测。
 *
 * 子图里两个不变量（normalizeBounds 的存在理由）：
 *   ① **忽略测量为 0 的节点**：节点的 DOM 尺寸由 React Flow 测量后写回
 *      `measured`。首帧（或视口裁剪下未挂载的节点）measured 还是 0，
 *      若照常参与包围盒，缩放会被算成一个远小于实际内容的框 —— 用户看到的
 *      就是「打开子工作流停在空白区域、有节点的位置在视野外」（ISSUE #394）。
 *   ② **包含折叠节点声明的尺寸**：折叠态的节点不渲染 body，measured 只剩标题
 *      条；此时用序列化里声明的 `style.width/height` 兜底，包围盒才覆盖整份图。
 *      坐标按**卡片顶边**参与（React Flow 的 `position` 即卡片顶边，见
 *      workflow-editor-build-nodes 的锚点约定）—— 与 measured 同一套坐标口径，
 *      混用「body 顶边」会让旧式 `position` 兜底算出整体上移的框。 */

/** 参与包围盒计算的节点最小结构。`wfNode` / `wfSubgraph` 节点与纯数据对象都能满足。 */
import { clamp } from "~/lib/clamp";

export interface FitBoundsNode {
  id?: string;
  position: { x: number; y: number };
  measured?: { width?: number; height?: number };
  width?: number;
  height?: number;
  style?: { width?: number | string; height?: number | string };
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface ViewportRect {
  width: number;
  height: number;
}

export interface ViewportPadding {
  /** 左右各留出的比例，0.12 → 内容占 76% 宽。 */
  x: number;
  /** 上下各留出的比例。 */
  y: number;
}

export interface FitViewport {
  x: number;
  y: number;
  zoom: number;
}

export const DEFAULT_VIEWPORT_PADDING: ViewportPadding = { x: 0.12, y: 0.12 };
/** 缩放上限：单节点子图不该被放到撑满屏幕。 */
export const DEFAULT_MAX_FIT_ZOOM = 1.5;
/** 聚焦缩放的下限**默认值**：找不到画布自己的 `minZoom` 时用它兜底。
 *
 *  注意它只是兜底 —— 编辑器里聚焦用的是**画布设置自己的** minZoom / maxZoom
 *  （见 WorkflowEditorInner 的 fitToContent）。曾有一版把 0.35 当成编辑器的
 *  硬下限，本意是别让超宽工作流缩成噪点，代价却是「打开后整份工作流仍有大半
 *  在视口外、还得手动滚轮」（ISSUE #717）：聚焦的意义就是**看得见全部内容**，
 *  下限交给用户在画布设置里自己定。 */
export const DEFAULT_MIN_FIT_ZOOM = 0.35;

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * 求「真实节点」的包围盒：跳过测量为 0 的节点，尺寸优先取实测值、
 * 再退到节点声明的 `style`，两者都没有则用兜底尺寸。
 */
export function normalizeBounds(
  nodes: readonly FitBoundsNode[],
  fallbackSize: { width: number; height: number },
): Bounds | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    const measuredW =
      toFiniteNumber(node.measured?.width) ?? toFiniteNumber(node.width);
    const measuredH =
      toFiniteNumber(node.measured?.height) ?? toFiniteNumber(node.height);
    const styleW = toFiniteNumber(node.style?.width);
    const styleH = toFiniteNumber(node.style?.height);
    const width =
      measuredW && measuredW > 0
        ? measuredW
        : styleW && styleW > 0
          ? styleW
          : fallbackSize.width;
    const height =
      measuredH && measuredH > 0
        ? measuredH
        : styleH && styleH > 0
          ? styleH
          : fallbackSize.height;

    const x = node.position.x;
    const y = node.position.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    if (x < minX) minX = x;
    if (x + width > maxX) maxX = x + width;
    if (y < minY) minY = y;
    if (y + height > maxY) maxY = y + height;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { minX, maxX, minY, maxY };
}

/**
 * 由包围盒算出「内容居中、按容器留白缩放」的视口。
 * `bounds` 为 null（没有可测量的节点）时返回 null，由调用方决定兜底（fitView）。
 */
export function computeFitViewport(
  bounds: Bounds | null,
  container: ViewportRect,
  options?: {
    padding?: ViewportPadding;
    minZoom?: number;
    maxZoom?: number;
  },
): FitViewport | null {
  if (!bounds) return null;
  const padding = options?.padding ?? DEFAULT_VIEWPORT_PADDING;
  const minZoom = options?.minZoom ?? DEFAULT_MIN_FIT_ZOOM;
  const maxZoom = options?.maxZoom ?? DEFAULT_MAX_FIT_ZOOM;

  const containerW = container.width > 0 ? container.width : 1200;
  const containerH = container.height > 0 ? container.height : 700;
  const bboxW = Math.max(1, bounds.maxX - bounds.minX);
  const bboxH = Math.max(1, bounds.maxY - bounds.minY);

  const fitW = (containerW * (1 - 2 * padding.x)) / bboxW;
  const fitH = (containerH * (1 - 2 * padding.y)) / bboxH;
  const zoom = clamp(Math.min(fitW, fitH), minZoom, maxZoom);

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return {
    x: containerW / 2 - zoom * centerX,
    y: containerH / 2 - zoom * centerY,
    zoom,
  };
}

/**
 * 「反复测量直到收敛」的聚焦步进器 —— 节点尺寸是挂载后测出来的，而画布开着
 * 视口裁剪：首帧只有上一视图留下的那片视口里的节点有尺寸，其余是 0。把这块
 * **局部测量结果**当成整张图的范围去 fit，视口就会停在离内容很远的地方
 * （ISSUE #394）。
 *
 * 用法：构造一次，然后在每帧调用 `next()`；返回该帧应当下发的包围盒，
 * 以及是否还需要继续（false 表示已收敛或到达护栏）。
 */
export interface FitSettleStepper {
  /** 推进一帧：`sample()` 返回当前这一帧真实量到的节点。 */
  next(sample: () => readonly FitBoundsNode[]): {
    bounds: Bounds | null;
    done: boolean;
  };
  /** 已推进的帧数（含首次采样）。 */
  rounds(): number;
}

export interface FitSettleOptions {
  /** 参与包围盒的节点都没量到尺寸时的兜底尺寸。 */
  fallbackSize: { width: number; height: number };
  /** 连续多少帧范围不再扩大就认为收敛。 */
  settleRounds: number;
  /** 帧数护栏，避免测量始终不稳时无限重算。 */
  maxAttempts: number;
}

export function createFitSettleStepper(
  options: FitSettleOptions,
): FitSettleStepper {
  let lastSpan = -1;
  let settleCount = 0;
  let attempts = 0;
  let lastBounds: Bounds | null = null;

  return {
    next(sample) {
      attempts += 1;
      const bounds = normalizeBounds(sample(), options.fallbackSize);
      if (bounds) {
        const span = bounds.maxX - bounds.minX + (bounds.maxY - bounds.minY);
        settleCount = span > lastSpan ? 0 : settleCount + 1;
        lastSpan = span;
        lastBounds = bounds;
      } else {
        settleCount += 1;
      }
      const done =
        settleCount >= options.settleRounds || attempts >= options.maxAttempts;
      return { bounds: bounds ?? lastBounds, done };
    },
    rounds: () => attempts,
  };
}

/**
 * 「每份图只自动聚焦一次」的调度器 —— 把「是否已经聚焦过」与「聚焦是否真的
 * 下发过」分开记账。
 *
 * 为什么必须分开（ISSUE #394 第二轮）：只按「图的 key」记一个布尔，会在
 * **effect 依赖抖动**时把图标记成「已聚焦」而其实一次都没聚焦到 ——
 *
 *   · 进入子图的那一次 commit 里，打开聚焦的 effect 先跑（按新图的 key 记账
 *     并排下一帧的 rAF），紧接着 `nodes` 同步 effect 把节点整批换掉；
 *   · 节点数变化会让聚焦 effect 重跑，先执行 cleanup（取消那个还没触发的
 *     rAF），再被「已聚焦」的记账拦住、不再排新的一帧；
 *   · 结果是：图被记成已聚焦，视口却一直停在**上一个视图**（用户看到的就是
 *     「打开子工作流没聚焦到」，与修好分批测量之前一模一样）。
 *
 * 所以记账的单位是「已**下发**过聚焦的图 key」：`isSettled(key)` 只管跳过；
 * `markPending(key)` 在排程时登记，`markSettled(key)` 才在真正下发视口后调用。
 * 同一 key 的 pending 状态允许被重复排程（帧被取消后重排），不会吃掉这次聚焦。
 */
export interface FitOnceScheduler {
  /** 这份图是否已经**下发**过自动聚焦（是 → 无需再排程）。 */
  isSettled(key: string): boolean;
  /** 排程这次聚焦：登记 pending。返回 false 表示这份图已下发过，调用方应放弃。 */
  markPending(key: string): boolean;
  /** 真正下发视口后调用：把这份图记为已聚焦（并清掉 pending）。 */
  markSettled(key: string): void;
}

export function createFitOnceScheduler(): FitOnceScheduler {
  const settled = new Set<string>();
  const pending = new Set<string>();
  return {
    isSettled: (key) => settled.has(key),
    markPending: (key) => {
      if (settled.has(key)) return false;
      pending.add(key);
      return true;
    },
    markSettled: (key) => {
      settled.add(key);
      pending.delete(key);
    },
  };
}
