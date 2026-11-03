/**
 * log-virtual — 日志面板的**虚拟滚动窗口**（纯逻辑，无 React、无 DOM）。规范 02 §2.6 要求大列表虚拟滚动：只渲染视口内几十行（满页 2000 行含行内 span 约 1.5 万节点，布局成本就是「切到 1000+ 页签明显卡顿」，ISSUE #609）。
 * 行高用**常量**而非 `measureElement`（动态测高在 2s 一轮刷新里会打断滚动）：单行 28px、多行每行 +19px，视图 class 必须与常量对齐，改字号行距要同步改这里。
 * 误差由 `overscan` 与总高钳位兜住；贴底「滚到哪行」的纯算术也在这里（ISSUE #637），视图只问 DOM 拿目标几何。
 */

/**
 * 一行（未换行）的像素高度：`text-sm` + `leading-snug` + `py-1` + 1px 下边框。
 * 必须与 `LogRow` 的 class 对齐。
 */
import { clamp } from "~/lib/clamp";

/**
 * 估算行高时从面板总宽扣掉「非正文列」的固定开销（时刻 + 级别徽标 + 来源 + 复制按钮 + 内边距 + 列间距，
 * 约 260px）。`countLines` 算软换行用的是**正文列**可用宽度：此前直接拿整宽估算会低估行数，正文被
 * `overflow-hidden` 裁掉（「超出边框看不全」）。取偏保守值——宁可多留空白，也不让内容跑到视口外。
 */
export const LOG_MESSAGE_OVERHEAD = 260;

export const LOG_ROW_SINGLE = 28;

/** 换行显示时，**每一行文字**的像素高度（`leading-snug` 下的 14px 行高 = 19.25）。 */
export const LOG_ROW_LINE = 19;

/**
 * **展开**的日志行高度（常量，不是量出来的）。展开内容交给 `JsonViewer`（自带工具栏 / 搜索与内部滚动），
 * 树的展开与搜索跳转都不改变**行**高，行高只由这个常量决定——这正是虚拟滚动的「可枚举」：`layoutRows`
 * 不必测 DOM 就能给位置，滚动位置与内容不会错开。取 360 ≈ 单行(28) + 一份够用的 JSON 视口。
 */
export const LOG_ROW_EXPANDED = 360;

/** 上下各多渲染几行：常量行高的小误差与快速滚动都不会露出空白。 */
export const LOG_VIRTUAL_OVERSCAN = 12;

/**
 * 估算出的总高度上限。浏览器对 `scrollHeight` 有精度上限（约 33,554,400px），超过后滚动位置会失真；
 * 这里取更保守的值并**按比例压缩映射**（§2.1.1 第 3 条），牺牲极端情况下的物理精度换整体稳定。
 * 一整页（`LOG_PAGE_SIZE` 行 × `LOG_ROW_SINGLE`）只有几万像素，它只对「超长单行堆满一整页」生效。
 */
export const LOG_SCROLL_MAX = 8_000_000;

/**
 * 一条日志在页面里的高度：`wrap` 为假时行不换行（`truncate`），恒为 {@link LOG_ROW_SINGLE}；为真时按显式
 * 换行符与软换行估算（软换行数由字符数除以每行容量，而容量取决于面板宽度）。这里只求「不低估」：低估会让
 * 下面几行被推到视口外，高估只是多留一点空白。
 */
export function estimateRowHeight(message: string, wrap: boolean): number {
  if (!wrap) {
    return LOG_ROW_SINGLE;
  }
  const lines = Math.max(1, countLines(message));
  return LOG_ROW_SINGLE + (lines - 1) * LOG_ROW_LINE;
}

/**
 * 消息在面板里**至少**占几行。显式换行（`\n`，多行 JSON payload）逐段数；每段再按宽度拆软换行——容量按
 * **最窄的字**（中文 13px）算，`ceil(段长 × 13 / 可用宽度)` 是下界。`availableWidth` 取不到（jsdom /
 * 首帧）时只数显式换行：宁可少估也不能瞎估。
 */
export function countLines(message: string, availableWidth = 0): number {
  const segments = message.split("\n");
  /* 行尾换行符产生的**末尾空段**不算独立的一行：一条以 `\n` 结尾的消息会被拆出
   * 一个空末段，若按它计数就会多估一整行空白（「只显示一行却占了两行空间」）。
   * 段中间的空段（空行）仍保留——它确实是一行。 */
  while (segments.length > 1 && segments.at(-1) === "") {
    segments.pop();
  }
  if (availableWidth <= 0) {
    return segments.length;
  }
  let total = 0;
  for (const segment of segments) {
    total += Math.max(1, Math.ceil((segment.length * 13) / availableWidth));
  }
  return Math.max(1, total);
}

/** 一条日志在列表里的位置与高度（见 {@link layoutRows}）。 */
export type RowLayout = {
  /** 该行的估算高度（像素）。 */
  size: number;
  /** 该行上边缘距列表顶部（不含顶部留白）的像素数。 */
  start: number;
};

/** {@link layoutRows} 的两类**按 id 点名**的行（见下方说明）。 */
export type LogLayoutOptions = {
  /** 已展开的行 id：固定为 {@link LOG_ROW_EXPANDED}。 */
  expandedIds?: ReadonlySet<string>;
  /**
   * 折叠态**强制单行**的行 id（comfy-cli 原始 JSON 行）。这类行的完整原文（可能几十 KB、不含换行符）在
   * `wrap` 下会被 `countLines` 按宽度估成几百行——既是错的显示（原文本该折起）也是错的滚动长度。
   * 折叠态恒为一行摘要，完整内容交给展开态，因此不参与换行估高。
   */
  singleLineIds?: ReadonlySet<string>;
};

/**
 * 估算整页每一行的位置与高度。**整页算一遍**而不是按需累加：位置是单调前缀和，`start[i]` 必须对得上
 * `sum(size[0..i-1])`，否则 `translateY` 与滚动条各说各话；整页 2000 次乘法远低于一帧预算（实测 < 1ms）。
 * `options` 的两类行按 **id** 点名（不用下标）：分页窗口随新日志前移，下标不稳定，而 id 与日志一一对应。
 */
export function layoutRows(
  entries: ReadonlyArray<{ id?: string; message: string }>,
  wrap: boolean,
  availableWidth = 0,
  options: LogLayoutOptions = {},
): { rows: Array<RowLayout>; totalSize: number } {
  const { expandedIds, singleLineIds } = options;
  /* `Array.from` 而不是 `new Array(n)`：后者在 lint 下是 `any[]`，会一路传染到
     下面的 `rows[i]` 赋值上。 */
  const rows: Array<RowLayout> = Array.from({ length: entries.length }, () => ({
    start: 0,
    size: LOG_ROW_SINGLE,
  }));
  let start = 0;
  for (const [i, entry] of entries.entries()) {
    const id = entry.id;
    let size: number;
    if (id && expandedIds?.has(id)) {
      size = LOG_ROW_EXPANDED;
    } else if (id && singleLineIds?.has(id)) {
      size = LOG_ROW_SINGLE;
    } else {
      /* 每行的行数只数一次：estimateRowHeight 与 countLines 都靠它推高度。 */
      const lines = wrap ? countLines(entry.message, availableWidth) : 1;
      size = LOG_ROW_SINGLE + (lines - 1) * LOG_ROW_LINE;
    }
    rows[i] = { start, size };
    start += size;
  }
  return { rows, totalSize: start };
}

/**
 * 滚动位置 → 要渲染的行区间（左闭右开）。四条边界缺一不可：`overscan` 上下各留几行（快速滚动 / 估高
 * 小误差不露空白）；**空列表返回空区间**（`end` 不得为负）；行数不足一屏时给全量（`end` 不超过
 * `rows.length`）；`scrollTop` 为负 / `NaN`（jsdom 与初次布局）当 0 处理。
 */
export function visibleRange(
  rows: ReadonlyArray<RowLayout>,
  scrollTop: number,
  viewportHeight: number,
  overscan = LOG_VIRTUAL_OVERSCAN,
): { end: number; start: number } {
  const count = rows.length;
  if (count === 0) {
    return { start: 0, end: 0 };
  }
  const top = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
  const height = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0;
  const pad = Math.max(0, overscan);

  const first = firstVisibleRow(rows, top);
  const last = firstVisibleRow(rows, top + height);
  const start = Math.max(0, first - pad);
  const end = Math.min(count, last + 1 + pad);
  return { start, end: Math.max(start, end) };
}

/**
 * 位置 `offset` 落在哪一行的**下标**（二分）。二分而不是线性扫描：滚动事件每帧都要一次，线性扫 2000 行
 * 在慢速设备上会直接体现为掉帧；`rows` 的 `start` 单调递增，因此二分成立。
 */
export function firstVisibleRow(rows: ReadonlyArray<RowLayout>, offset: number): number {
  if (rows.length === 0) {
    return 0;
  }
  let low = 0;
  let high = rows.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((rows.at(mid)?.start ?? Number.POSITIVE_INFINITY) <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low;
}

/**
 * 估算总高 → 撑开滚动条的实际高度（超限时按比例压缩，见 {@link LOG_SCROLL_MAX}）。同时给出 `ratio`：
 * 滚动位置要跟着这个比例反向换算，否则「压缩后的列表」里滚一半对应的是真实高度里的另一处。
 */
export function scrollHeightOf(estimated: number): {
  compressed: boolean;
  height: number;
} {
  /* 取不到 / 负数一律当 0：`Math.max(0, NaN)` 是 NaN，直接交给 style 会得到
   * 一个非法的 `height: NaNpx`（浏览器静默忽略，滚动条长度就与内容对不上了）。 */
  if (!Number.isFinite(estimated) || estimated <= 0) {
    return { height: 0, compressed: false };
  }
  if (estimated <= LOG_SCROLL_MAX) {
    return { height: estimated, compressed: false };
  }
  return { height: LOG_SCROLL_MAX, compressed: true };
}

/* ── 贴底（pin）：新日志到达时把「已读水位」钉住 ────────────────────────
 * 面板贴底时不追最新，只把**基线**（用户读到的最后一条）钉在原地，新行在它下面累积（见 `LogPanel`
 * 的贴底 effect，ISSUE #262 复审）。三个判据抽成纯函数：位置算得对是可见结果的前提（「滚不到底」正是
 * 这里算歪的），DOM 只提供「目标行有没有渲染 / 它的几何」，算术不留在视图里。 */

/**
 * 贴底目标行的**页内序号**：`max(基线, 已追到哪)`，并钳到本页最后一条。取 max 是为了「新行一条条露出来」
 * （不跳空），钳到末条是为了不被后面的新行无限拖走。
 */
export function pinTargetIndex(baseline: number, applied: number, bottomIndex: number): number {
  return Math.max(clamp(baseline, 0, bottomIndex), clamp(applied, 0, bottomIndex));
}

/**
 * 贴底要写入的 `scrollTop`：让目标行**贴住视口底边**。几何**只取自位置表** `rows[...]`：① 它是
 * `translateY`（渲染）与滚动条（总高）共用的同一份口径，真实节点的 `offsetTop + offsetHeight` 是第二套
 * 坐标、会在窗口边界分叉；② 虚拟化后 offsetParent 是 `translateY` 内层容器，`offsetTop` 回答「它在当前
 * 窗口里的位置」，拿它算会把视口拉回窗口起点（e2e 的「滚不到底」）。窗口外的目标行也走同一张表，两轮同解。 */
export function pinScrollTop(
  geometry: { size: number; start: number },
  viewportHeight: number,
): number {
  const viewport = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0;
  const next = geometry.start + geometry.size - viewport;
  return Number.isFinite(next) ? Math.max(0, next) : 0;
}

/**
 * 贴底这一轮**该不该动、动到哪一行**：返回目标行序号，`null` 表示本轮不动。两层判据：
 * ① 目标 = {@link pinTargetIndex}（基线/已追到哪取大，钳到末条）；② **用户接管了滚动就不动**——
 * 当前位置 `scrollTop` 已不是本 effect 上次写入的 `appliedTop`，说明用户滚到了别处；贴底只负责钉住
 * 已读水位、不把用户按回水位（覆盖会把「滚不到底」做成常态）。容差 1px 吸收浏览器的小数取整。 */
export function pinPlan(input: {
  applied: number;
  appliedTop: number;
  baseline: number;
  bottomIndex: number;
  scrollTop: number;
}): number | null {
  const targetIndex = pinTargetIndex(input.baseline, input.applied, input.bottomIndex);
  const userTookOver =
    input.applied === targetIndex && Math.abs(input.scrollTop - input.appliedTop) > 1;
  return userTookOver ? null : targetIndex;
}
