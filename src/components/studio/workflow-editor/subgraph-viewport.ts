/* 子工作流 / 工作流画布的「打开时聚焦」计算 —— 纯函数，无 React 依赖。
 *
 * 从 WorkflowEditorInner 的画布聚焦逻辑中抽出：这套「取真实节点包围盒 →
 * 按容器留白算 zoom → 求居中视口」的算式在子图里最容易出错，必须能单测。
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
/** 缩放下限：宽图（130+ 节点）自动缩到 0.15 时节点缩成噪点，宁可留边也不越过此值。 */
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
    const measuredW = toFiniteNumber(node.measured?.width) ?? toFiniteNumber(node.width);
    const measuredH = toFiniteNumber(node.measured?.height) ?? toFiniteNumber(node.height);
    const styleW = toFiniteNumber(node.style?.width);
    const styleH = toFiniteNumber(node.style?.height);
    const width = measuredW && measuredW > 0 ? measuredW : styleW && styleW > 0 ? styleW : fallbackSize.width;
    const height = measuredH && measuredH > 0 ? measuredH : styleH && styleH > 0 ? styleH : fallbackSize.height;

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
  const zoom = Math.max(minZoom, Math.min(fitW, fitH, maxZoom));

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
  next(sample: () => readonly FitBoundsNode[]): { bounds: Bounds | null; done: boolean };
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

export function createFitSettleStepper(options: FitSettleOptions): FitSettleStepper {
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
      const done = settleCount >= options.settleRounds || attempts >= options.maxAttempts;
      return { bounds: bounds ?? lastBounds, done };
    },
    rounds: () => attempts,
  };
}
