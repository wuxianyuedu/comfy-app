// ── 「一张媒体图的自然尺寸是多少」的唯一出口（规范 16 §16.2.4.31）────────────
//
// 按**形态**扫描时撞出来的账：`naturalWidth` / `naturalHeight`（视频是
// `videoWidth` / `videoHeight`）读一遍再算，散在预览与缩略图几处 ——
// 而差别不在「读哪两个属性」，在**两个语义决定**上：
//
//   ① **读不到尺寸时怎么办** —— `WorkflowImagePreview` 写的是
//      `if (el.naturalWidth && el.naturalHeight)`，即**把 0 当缺值静默跳过**；
//      而同一库里的另外几处拿到 0 之后照算，得出 `NaN` 或 `Infinity` 的比例，
//      渲染成「0 × 0」或直接把容器高度算崩。
//   ② **算成什么** —— 有的要 `{ w, h }` 原样显示（「1102 × 834」），
//      有的要宽高比（`w / h`）去给容器定高度，有的要「是不是竖图」这一个布尔。
//      三件事各自从两个数出发、各自判 0 一次，于是「同一张图在不同面板里
//      被算成不同的形状」——这句话不是比喻：同一张 0 高（读失败）的图，
//      一处显示「—」，另一处显示「Infinity」。
//
// 也就是说 —— **「这张图显示多大」取决于它是哪个面板渲染出来的**。
// 这类差异没有报错、没有告警，tsc / eslint 也都不看（`naturalWidth` 是 number，
// 除以 0 得到 `Infinity` 也合法）。
//
// 与 `~/lib/media/media-kind` 的分工：那个判「这是图片还是视频」（按后缀），
// 本模块判「它的自然尺寸是多少、比例是什么」。两者都不碰 DOM 类型之外的宿主：
// `element` 只要求有那四个尺寸读数，所以可以脱离真实图片单测。

/** 读自然尺寸需要的最小宿主形状（`HTMLImageElement` / `HTMLVideoElement` 都满足）。 */
export interface NaturalSizeSource {
  naturalWidth?: number;
  naturalHeight?: number;
  videoWidth?: number;
  videoHeight?: number;
}

/** 一张媒体的自然尺寸（像素）。两个数都保证是**正**的有限数。 */
export interface NaturalSize {
  width: number;
  height: number;
}

/**
 * 从媒体元素读出自然尺寸；读不到（0 / NaN / 负 / 无限）返回 `null`。
 *
 * **`null` 而不是 `{0, 0}`**：媒体元素在图片解码完成前、视频元数据到达前，
 * 四个属性全都读作 0 —— 那是「还不知道」而不是「尺寸是 0」。
 * 把两者压成同一个值的写法（收口前有几处正是）会让下游的除法产出
 * `Infinity` 或 `NaN`，而它在界面上表现为一个塌掉的盒子，看不出原因。
 *
 * 图片读 `natural*`、视频读 `video*`，两者都读不到才判空 —— 这样调用处
 * 不必先判「这是图还是视频」（`MediaThumbnail` 的 `onLoad` 两种元素都给）。
 */
export function readNaturalSize(
  element: NaturalSizeSource | null | undefined,
): NaturalSize | null {
  if (!element) return null;
  const width = element.naturalWidth ?? element.videoWidth ?? 0;
  const height = element.naturalHeight ?? element.videoHeight ?? 0;
  if (!isPositiveFinite(width) || !isPositiveFinite(height)) return null;
  return { width, height };
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * 宽高比（宽 / 高）；读不到尺寸时返回 `null`。
 *
 * 返回 `null` 而不是 `NaN` / `Infinity`：调用处做「按比例定高」这类计算时，
 * 那两个值的可见后果是**容器塌成 0 高或被撑到无穷**，而不是一句可解释的失败。
 */
export function naturalAspectRatio(
  element: NaturalSizeSource | null | undefined,
): number | null {
  const size = readNaturalSize(element);
  return size ? size.width / size.height : null;
}

/**
 * 是否竖图（高 > 宽）；读不到尺寸时返回 `null`（**不是 `false`**）。
 *
 * 三态是刻意的：「还不知道」与「确定不是竖图」在布局上是两种处置 ——
 * 前者该保持占位盒、后者该走横图分支。压成布尔会让「还没加载完」
 * 被当成横图渲染一次，图片到位后再跳一次（列表滚动时的抖动来源之一）。
 */
export function isPortraitMedia(
  element: NaturalSizeSource | null | undefined,
): boolean | null {
  const size = readNaturalSize(element);
  return size ? size.height > size.width : null;
}

/**
 * 尺寸的展示文案（`1102 × 834`）；读不到时返回 `null`。
 *
 * 用 `×`（U+00D7）而不是 `x`：这是标记里手写的那一个字符，各处必须一致 ——
 * 收口前预览用的是 `×`、另一处用的是 `x`，并排看像两种数据。
 */
export function formatNaturalSize(
  element: NaturalSizeSource | null | undefined,
): string | null {
  const size = readNaturalSize(element);
  return size ? `${size.width} × ${size.height}` : null;
}
