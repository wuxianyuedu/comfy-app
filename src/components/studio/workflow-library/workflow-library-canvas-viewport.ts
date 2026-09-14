// 工作流库「画布节点」预览的**只读平移 / 缩放视口**（纯函数，规范 §17.2 第①层）。
//
// 库里的画布预览是几张卡片并排的一张静态图：宽度超出面板时，此前只能靠整页
// 横向滚动 —— 而面板自身就是「撑满父级、否则内部滚动」的容器，用户看到的
// 就是「超出去的部分拖不动」。
//
// 这里给出平移/缩放的全部算式（无 React、无 DOM、可单测），视图只负责把指针
// 事件翻译成参数并写回 tx / ty / zoom：
//
//   · 指针拖动 = 改 tx / ty（内容跟着手走，就是「拖动画布看别处」）；
//   · 滚轮 = 缩放（Ctrl / ⌘ + 滚轮也一样，轨迹板与鼠标都走同一条路）；
//   · 「适应」= 重新居中并缩到刚好放得下；
//   · 「复位」= 回到初始布局（三列整体居中）。
//
// 只读：本模块不碰映射、不碰连线，连线量测读的是被平移后的真实 DOM 矩形，
// 因此拖动画布不会让线错位（不会因为改了 transform 就「线飘走」）。

/** 视口状态：内容坐标系 → 屏幕的平移量与缩放比。 */
export interface LibraryViewport {
  /** 平移量（px）。 */
  tx: number;
  ty: number;
  /** 缩放比（1 = 100%）。 */
  zoom: number;
}

export const IDENTITY_VIEWPORT: LibraryViewport = { tx: 0, ty: 0, zoom: 1 };

/** 缩放上下限：与项目画布同一档心智（缩到 35% 仍读得出卡片标题，放到 200% 不糊）。 */
export const MIN_VIEWPORT_ZOOM = 0.35;
export const MAX_VIEWPORT_ZOOM = 2;

/** 拖动判据：位移小于这个像素数就当成「点一下」，不改平移 —— 否则点卡片选中、
 *  点输入框聚焦都会被一次 1~2px 的手抖变成画面位移。 */
export const PAN_DRAG_THRESHOLD = 4;

/** 限幅：把缩放夹到 [MIN, MAX]。NaN / 非有限值一律退回 1。 */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_VIEWPORT_ZOOM, Math.max(MIN_VIEWPORT_ZOOM, zoom));
}

/** 指针拖动：把「这一帧指针移动了多少」换算进平移量。
 *
 *  除以缩放是必须的：内容放大到 150% 时，手指走 15px 只该让内容走 10px ——
 *  否则拖动速度与画面速度对不上，放大后「拖不动 / 拖过头」。 */
export function panBy(
  viewport: LibraryViewport,
  delta: { dx: number; dy: number },
): LibraryViewport {
  const scale = viewport.zoom || 1;
  return {
    tx: viewport.tx + delta.dx / scale,
    ty: viewport.ty + delta.dy / scale,
    zoom: viewport.zoom,
  };
}

/** 以某个**屏幕锚点**（通常是光标位置）为中心缩放。
 *
 *  锚点处的内容在缩放前后停在原地 —— 不这么做的话，滚轮缩放会围绕容器中心
 *  进行，用户盯着的那张卡会滑出视野（读作「一缩放就找不到自己在看哪」）。 */
export function zoomAt(
  viewport: LibraryViewport,
  anchor: { x: number; y: number },
  nextZoom: number,
): LibraryViewport {
  const zoom = clampZoom(nextZoom);
  const ratio = zoom / (viewport.zoom || 1);
  return {
    zoom,
    tx: anchor.x - (anchor.x - viewport.tx) * ratio,
    ty: anchor.y - (anchor.y - viewport.ty) * ratio,
  };
}

/** 滚轮 → 缩放比：向上滚放大、向下滚缩小，一步固定倍率。
 *
 *  为什么不按 `deltaY` 连续取值：轨迹板的 deltaY 一次能到几百，连续取值会
 *  一滚就跳到底；固定步进让鼠标与轨迹板的手感一致。 */
export const ZOOM_STEP = 1.15;

export function zoomStepFromWheel(current: number, deltaY: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return clampZoom(current);
  return clampZoom(current * (deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP));
}

/** 「适应」：把整块内容缩放到刚好放得下（不放大超过 100%），并居中。
 *
 *  内容是「卡片列 + 宿主卡片 + 输出卡片列」三列的并集，宽度常上千 px 而面板
 *  只有几百 —— 没有这一步，用户打开就看到中间一小块。 */
export function fitViewport(
  content: { width: number; height: number },
  container: { width: number; height: number },
): LibraryViewport {
  const { width: cw, height: ch } = content;
  const { width: vw, height: vh } = container;
  if (
    !Number.isFinite(cw) ||
    !Number.isFinite(ch) ||
    !Number.isFinite(vw) ||
    !Number.isFinite(vh) ||
    cw <= 0 ||
    ch <= 0 ||
    vw <= 0 ||
    vh <= 0
  ) {
    return IDENTITY_VIEWPORT;
  }
  /* 留一点边距（与画布的 fitView padding 同量级），否则内容贴着面板边缘。 */
  const scale = clampZoom(Math.min((vw - 32) / cw, (vh - 32) / ch, 1));
  return {
    zoom: scale,
    tx: (vw - cw * scale) / 2,
    ty: (vh - ch * scale) / 2,
  };
}

/** 视口是否处于初始状态（决定「复位」按钮是否可用 —— 点了没变化就不该亮着）。 */
export function isIdentityViewport(viewport: LibraryViewport): boolean {
  return (
    Math.abs(viewport.tx) < 0.5 &&
    Math.abs(viewport.ty) < 0.5 &&
    Math.abs(viewport.zoom - 1) < 0.001
  );
}

/** transform 的 CSS 文本（视图直接用它，避免两处各拼一遍字符串拼错）。 */
export function viewportTransform(viewport: LibraryViewport): string {
  return `translate3d(${round(viewport.tx)}px, ${round(viewport.ty)}px, 0) scale(${round(viewport.zoom, 4)})`;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 缩放百分比展示（状态条上的「120%」）。 */
export function zoomLabel(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}
