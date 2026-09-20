// ── 「量一个元素的几何」的唯一出口（规范 16 §16.2.4.41）────────────────────
//
// 按**形态**扫描时撞出来的账：全库有五六处在「读一个元素的盒子，再把量出来的
// 值用于某个判据」——而它们对同一件事各判各的：
//
//   ① `use-custom-nodes-settings` 的日志面板内偏移：**两个 rect 相减**
//      （`target` 的 top 减 `console_` 的 top），注释里还写着「不能用
//      `offsetTop`，它会回退到 fixed 包装」；
//   ② `LogPanel` 的视口量测：`ResizeObserver` + `clientWidth/clientHeight`，
//      自己写「取值真变了才落状态」的等值判断；
//   ③ `WorkflowLibraryCanvas` 的画布底图尺寸：`ResizeObserver` +
//      `getBoundingClientRect()`，首帧用 `LAYOUT_SIZING` 的兜底值；
//   ④ `ScriptMarkdownEditor` 的「跳到第 N 行」：`scrollHeight / lines.length`
//      估行高 + `clientHeight / 2` 居中；
//   ⑤ `WorkflowStores` → `rectToAnchor` 的浮层锚点矩形（虚拟锚点）。
//
// 五处的差别不在「读哪几个属性」，而在三个**语义决定**上：
//
//   · **量不到时算什么** —— ④ 直接算（未挂载时 `scrollHeight` 是 0，于是行高
//     是 0、滚动到底部）；②③ 用兜底常量；① 有 `if (!console_) return`。
//     同一件事（量不到）在五处有三种处理。
//   · **「还没量」与「量出来是 0」分不分得开** —— 元素未挂载 / `display:none`
//     时所有读数都是 0，那是「还不知道」而不是「尺寸是 0」——压成同一个 0
//     会让首帧按 0 渲染一次再跳一下（与 `~/lib/media/natural-size` 的
//     `{0,0}` 是同一个坑，那里已收口）。
//   · **相对谁量** —— ③ 量的是容器自己，① 量的是「目标相对面板」，⑤ 量的是
//     「锚点相对视口」。三者的 `rect` 相减方向与是否加 `scrollTop` 各写一遍，
//     错一处就是「滚不到那一条」这种只有在特定滚动位置才复现的 bug。
//
// 也就是说 —— **「这个元素有多大 / 它相对另一个元素在哪」取决于它是哪一处写的**。
// 这类差异没有报错、没有告警，tsc / eslint 也都不看（都是合法的 DOM 属性读取）。
//
// ## 收什么、不收什么
//
// **收**：读盒子的形状（尺寸 / 视口位置 / **面板内偏移**）、「量不到」的表达
// （一律 `null`，不落成 0）、行高估算（`readLineHeight`）、锚点矩形的归一
// （`rectToAnchorRect`，供 base-ui 的虚拟锚点用）。
// **不收**：什么时候去量（挂载 / `ResizeObserver` 的接线归
// `~/components/ui/use-element-box`）、量出来之后画什么（归各自的视图）。
//
// ## 它不是「Node-only」模块
//
// 本模块**只读 DOM 属性**，没有 Node 内建依赖，也**不加** `server-only` ——
// 它由视图层（`"use client"`）直接使用（§18.4 三选一的第三类：没有 Node 依赖
// 的纯函数模块）。

/** 一个元素的盒子（相对视口的矩形 + 内容尺寸）。 */
export interface ElementBox {
  /** 视口坐标系里的位置与尺寸（`getBoundingClientRect` 的读数）。 */
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  /** **布局尺寸**（`clientWidth` / `clientHeight`，不含滚动条、取整）。 */
  clientWidth: number;
  clientHeight: number;
  /** **内容尺寸**（`scrollWidth` / `scrollHeight`，含溢出部分）。 */
  scrollWidth: number;
  scrollHeight: number;
  /** 相对**视口**的滚动偏移（`window.scrollX/Y`），用于换算绝对位置。 */
  pageX: number;
  pageY: number;
}

const EMPTY_RECT: DOMRect = {
  x: 0,
  y: 0,
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
};

/**
 * 量一个元素的盒子。
 *
 * **量不到时返回 `null`，不返回「全 0 的盒子」**：元素未挂载 / `display:none`
 * 时所有读数都是 0，而那是「还不知道」—— 把它当成「尺寸是 0」会让首帧按 0
 * 渲染一次再跳一下（`~/lib/media/natural-size` 的 `{0,0}` 是同一个坑）。
 *
 * `noRect` 为真时（如「只想要尺寸、不要视口位置」的场景）跳过
 * `getBoundingClientRect` 那一档 —— 代价小，但避免在滚动回调里强制布局。
 */
export function readElementBox(
  el: Element | null | undefined,
  options: { noRect?: boolean } = {},
): ElementBox | null {
  if (!el) return null;
  /* `Element` 的 `clientWidth` 等只在 `HTMLElement` / `Element` 上都有；
   * 用 `typeof` 守卫而不是 `instanceof HTMLElement`：jsdom 与 SSR 的构造器
   * 可能不是同一个（跨 realm 时 `instanceof` 会假阴性）。 */
  const box = el as Element & {
    clientWidth?: number;
    clientHeight?: number;
    scrollWidth?: number;
    scrollHeight?: number;
  };
  if (typeof box.clientWidth !== "number") return null;
  const rect =
    options.noRect || typeof box.getBoundingClientRect !== "function"
      ? EMPTY_RECT
      : box.getBoundingClientRect();
  const view = typeof window === "undefined" ? null : window;
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
    clientWidth: box.clientWidth ?? 0,
    clientHeight: box.clientHeight ?? 0,
    scrollWidth: box.scrollWidth ?? 0,
    scrollHeight: box.scrollHeight ?? 0,
    pageX: view?.scrollX ?? 0,
    pageY: view?.scrollY ?? 0,
  };
}

/**
 * `inner` **相对** `outer` 的纵向偏移 —— 即「在 `outer` 的面板内容里的位置」。
 *
 * 收口前这段算术写在 `use-custom-nodes-settings` 的滚动定位里，注释明确记着
 * 不能用 `inner.offsetTop`（`offsetParent` 会回退到更高层的 `fixed` 包装，
 * 得到乱值）。这里把正确的算式收一处：**两个 rect 的 top 相减 + `outer`
 * 自身的滚动偏移**（外层已滚过一段时，相对内容的位置要把那段加回来）。
 *
 * 任一侧量不到时返回 `null`（不返回 0 —— 0 是「就在顶部」，一个合法的位置）。
 */
export function offsetWithin(
  inner: Element | null | undefined,
  outer: Element | null | undefined,
): number | null {
  if (!inner || !outer) return null;
  const innerRect = inner.getBoundingClientRect();
  const outerRect = outer.getBoundingClientRect();
  const outerScroll =
    (outer as unknown as { scrollTop?: number }).scrollTop ?? 0;
  return innerRect.top - outerRect.top + outerScroll;
}

/**
 * `inner` 是否已经**部分或全部**落在 `outer` 的可视区域里。
 *
 * 与 `offsetWithin` 同一个坐标系（都是视口矩形），所以「要不要滚」与
 * 「滚到哪」用的是同一份读数 —— 分两处各量一次是「滚过头 / 滚不到」的成因。
 */
export function isWithinViewport(
  inner: Element | null | undefined,
  outer: Element | null | undefined,
): boolean {
  if (!inner || !outer) return false;
  const i = inner.getBoundingClientRect();
  const o = outer.getBoundingClientRect();
  return i.bottom > o.top && i.top < o.bottom;
}

/**
 * 从「一行文字的容器」估算**单行高度**。
 *
 * 用于「跳到第 N 行」这类按行号的定位：`textarea` / `pre` 的行高就是
 * `scrollHeight / 行数`。收口前这段在 `ScriptMarkdownEditor` 里就地写
 * （`el.scrollHeight / lines.length`），而**除数为 0 时给出 `Infinity`**
 * ——那会把 `scrollTo({ top: Infinity })` 交给浏览器。这里量不到就返回 `null`。
 */
export function readLineHeight(
  el: Element | null | undefined,
  lineCount: number,
): number | null {
  if (!el || lineCount <= 0) return null;
  const scrollHeight = (el as { scrollHeight?: number }).scrollHeight;
  if (typeof scrollHeight !== "number" || scrollHeight <= 0) return null;
  return scrollHeight / lineCount;
}

/**
 * 把「第 N 行」换算成 `scrollTo` 的目标 `top`（让那一行**居中**）。
 *
 * 收口前是 `Math.max(0, line * lineHeight - el.clientHeight / 2)`，其中
 * `lineHeight` 由调用处自己估、`clientHeight` 自己读。三段算术合成一处，
 * 「行高估错」与「居中算错」不会再各自漂移。
 */
export function centerLineScrollTop(
  line: number,
  lineHeight: number,
  viewportHeight: number,
): number {
  return Math.max(0, line * lineHeight - viewportHeight / 2);
}

/** base-ui 虚拟锚点需要的矩形形状（`getBoundingClientRect` 的返回形状子集）。 */
export interface AnchorRect {
  x: number;
  y: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * 把 `DOMRect` 归一成**可以冻存的**锚点矩形。
 *
 * 为什么需要归一：`DOMRect` 是**活的对象**（每次读属性都反映当前布局），
 * 不可序列化、也不能进 store（`WorkflowStores` 的 viewer 状态要能跨
 * 画布平移 / 缩放存活 —— 浮层存续期间锚点不跟着动）。所以取值一次、
 * 存成普通对象。收口前这段在 `~/components/studio/workflow-utils` 里
 * 与「节点包名解析」等一堆无关函数挤在同一文件。
 */
export function rectToAnchorRect(rect: DOMRect): AnchorRect {
  return {
    x: rect.x,
    y: rect.y,
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * 把 {@link AnchorRect} 装配成 Floating UI 的 **VirtualElement**
 * （只需 `getBoundingClientRect`）。
 *
 * 与 `rectToAnchorRect` 分开是因为用途不同：前者是**存储形状**（可进 store），
 * 后者是**接口形状**（给 Positioner 用）。合并会让 store 里躺着一个带方法的对象。
 */
export function anchorRectToVirtualElement(rect: AnchorRect): {
  getBoundingClientRect: () => AnchorRect & { toJSON: () => unknown };
} {
  return {
    getBoundingClientRect: () => ({ ...rect, toJSON: () => ({}) }),
  };
}
