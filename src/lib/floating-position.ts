/**
 * 浮层（popover / 下拉）视口定位的纯判据。
 *
 * 为什么独立成模块：按规范 17 §17.2 的分层，「打开后往哪儿摆」是删掉 JSX
 * 还能跑的纯派生（第①层），可脱离 React 用矩形数字直接单测；视图层只负责
 * 量出触发器矩形、把结果塞进 inline style。
 *
 * 背景（ISSUE #349）：工作流节点的 seed 行是表单的**最后一行**，「控件后行为」
 * 面板从触发器向下固定弹出，面板高约 270px，底部直接越过窗口下沿——最后一个
 * 选项连点都点不到（截图上只露出三项）。同一类事故在 IO 预览面板、滚动表单里
 * 也出现过多次，根因都是「只算 top、不算有没有地方放」。
 *
 * 因此这里把三件事钉成同一套判据：
 *   1. 左右：默认按触发器右沿对齐，越界时先夹回视口、再在实在放不下时缩宽；
 *   2. 上下：下方空间不足（且比上方更挤）时**翻到触发器上方**；
 *   3. 高度：给面板封顶（视口富余高度），溢出交给面板自身滚动。
 */

/** 浮层与视口边缘的最小留白（px）。 */
export const FLOAT_MARGIN = 8;

/** 测量入参：全部是视口坐标（`getBoundingClientRect` 的产物）。 */
export interface FloatRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** 定位基准：`right` = 面板右沿贴触发器右沿（默认，向下弹的下拉都在右侧）；
 *  `left` = 面板左沿贴触发器左沿。 */
export type FloatAlign = "left" | "right";

export interface FloatPlacementInput {
  /** 触发器矩形。 */
  trigger: FloatRect;
  /** 期望面板宽度（px）；视口放不下时会被收窄。 */
  width: number;
  /** 面板实测/预估高度（px）。 */
  height: number;
  /** 视口宽高（传 `window.innerWidth/innerHeight`）。 */
  viewport: { width: number; height: number };
  /** 期望的对齐方式，默认 `right`。 */
  align?: FloatAlign;
  /** 面板与触发器之间的间距（px），默认 6。 */
  gap?: number;
  /** 与视口边缘的留白，默认 {@link FLOAT_MARGIN}。 */
  margin?: number;
  /** 上下翻转的滞回阈值（px）：只有「上方空间比下方多出这么多」才翻，
   *  避免面板贴着视口中线时随画布微动来回跳。默认 0。 */
  flipHysteresis?: number;
}

export interface FloatPlacement {
  /** 判定好的面板左沿（视口坐标，已夹进视口）。 */
  left: number;
  /** 判定好的面板上沿（视口坐标，已夹进视口）。 */
  top: number;
  /** 实际可用宽度（≤ 期望宽度，且 ≤ 视口宽度 - 两侧留白）。 */
  width: number;
  /** 高度上限：面板自身按 `max-height` + 滚动消费，保证底边不越界。 */
  maxHeight: number;
  /** 最终摆放方向，供测试与需要跟随的箭头等消费。 */
  placement: "down" | "up";
}

/** 把 `value` 夹进 `[min, max]`；`max < min` 时返回 `min`（宁可靠边，不摆到视口外）。 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

/**
 * 算出一块浮层该摆在视口的哪儿。
 *
 * 摆位顺序：先定宽度（左右夹紧，必要时收窄）→ 再定高度上限（可用视口高度减留白）
 * → 最后定方向（下方放得下就向下，否则上方更宽松就翻上去）。
 */
export function placeFloating(input: FloatPlacementInput): FloatPlacement {
  const { trigger, width, height, viewport } = input;
  const align = input.align ?? "right";
  const gap = input.gap ?? 6;
  const margin = input.margin ?? FLOAT_MARGIN;
  const hysteresis = input.flipHysteresis ?? 0;

  /* ── 宽度与水平位置 ────────────────────────────────────────────────
   * 视口富余宽度（两侧留白后）比期望宽度还小时先收窄——否则后面怎么夹都会溢出。 */
  const availableWidth = Math.max(0, viewport.width - margin * 2);
  const finalWidth = Math.min(width, availableWidth);
  const preferredLeft =
    align === "right" ? trigger.right - finalWidth : trigger.left;
  const left = clamp(
    preferredLeft,
    margin,
    viewport.width - margin - finalWidth,
  );

  /* ── 高度上限 ──────────────────────────────────────────────────────
   * 上限 = 视口高度 - 两侧留白。面板自身按这个值做 max-height + 滚动，
   * 于是「面板比视口还高」时也不会有内容被裁在视口外。 */
  const maxHeight = Math.max(0, viewport.height - margin * 2);
  const panelHeight = Math.min(height, maxHeight);

  /* ── 方向 ──────────────────────────────────────────────────────────
   * 下方放不下、且上方确实更宽松（多出滞回阈值）→ 翻到上方；否则仍向下，
   * 由 height 上限兜住底边。 */
  const spaceBelow = viewport.height - trigger.bottom - margin - gap;
  const spaceAbove = trigger.top - margin - gap;
  const fitsBelow = spaceBelow >= panelHeight;
  const placement: "down" | "up" =
    fitsBelow || spaceAbove <= spaceBelow + hysteresis ? "down" : "up";

  const top =
    placement === "down"
      ? trigger.bottom + gap
      : Math.max(margin, trigger.top - gap - panelHeight);

  return { left, top, width: finalWidth, maxHeight, placement };
}
