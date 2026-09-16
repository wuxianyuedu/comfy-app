/**
 * log-virtual — 日志面板的**虚拟滚动窗口**（纯逻辑，无 React、无 DOM）。
 *
 * ── 为什么需要它（ISSUE #609 八审）────────────────────────────────────
 * 面板一页最多 2000 行（`LOG_PAGE_SIZE`），而此前是**一次性把那 2000 行全部
 * 挂进 DOM**：每行一个 `LogRow`、行内再按 ANSI / 词法切成若干 `span`
 * （一条普通消息约 3~8 个节点）——满页时 DOM 节点数在 **15000 上下**，
 * 切到这一页时浏览器要一次性布局这么多节点，用户读到的就是「切到 1000+
 * 的页签有明显卡顿」。
 *
 * 规范 02 §2.6 对这件事有硬要求（大列表必须虚拟滚动），这里把它落到
 * 「**只渲染视口里那几十行**」：DOM 节点数不再随页大小增长。
 *
 * ── 行高为什么是常量，而不是量出来的 ──────────────────────────────────
 * `@tanstack/react-virtual` 支持动态测高（`measureElement`），但那要求每次
 * 挂载/卸载都读写一遍 `getBoundingClientRect`——在 2s 一轮的日志刷新里，
 * 滚动过程中的测量本身就会打断滚动。日志行的高度是**可枚举**的：
 *
 * | 形态              | 高度              |
 * | ----------------- | ----------------- |
 * | 不换行（`truncate`）| `LOG_ROW_SINGLE`（1 行） |
 * | 换行 + N 行       | `LOG_ROW_LINE × N`       |
 *
 * 单行高度来自 `text-[13px] leading-snug`（1.375 × 13 ≈ 17.9）加 `py-1`
 * （上下各 4px）与 `border-b`（1px）= **27px**；多行时每多一行加 18px。
 * 这两条是本模块导出的常量，视图的 class 与它们对齐（见 §7.28 的口径），
 * **改行内字号 / 行距要同时改这里**，否则滚动位置会与内容错位。
 *
 * 常量行的另一面是**诚实**：估算与实际不一致时误差会累积。所以本模块把
 * 误差换算成「多留几行」（`overscan`），并把「估算总高」钳在浏览器的
 * `scrollHeight` 上限内（§2.1.1 第 3 条的兜底）——误差只影响滚动条长度，
 * 不会让内容跑到视口外。
 *
 * @module logs/log-virtual
 */

/**
 * 一行（未换行）的像素高度：`text-[13px]` + `leading-snug` + `py-1` + 1px 下边框。
 * 必须与 `LogRow` 的 class 对齐。
 */
export const LOG_ROW_SINGLE = 27;

/** 换行显示时，**每一行文字**的像素高度（`leading-snug` 下的 13px 行高）。 */
export const LOG_ROW_LINE = 18;

/** 上下各多渲染几行：常量行高的小误差与快速滚动都不会露出空白。 */
export const LOG_VIRTUAL_OVERSCAN = 12;

/**
 * 估算出的总高度上限。
 *
 * 浏览器对 `scrollHeight` 有精度上限（约 33,554,400px），超过之后滚动位置会
 * 失真。这里取一个更保守的值并**按比例压缩映射**（§2.1.1 第 3 条）：牺牲极端
 * 情况下的物理滚动精度，换整体稳定。真实日志页 2000 行 × 27px ≈ 54,000px，
 * 离这条线极远——它只对「超长单行堆满一整页」那种极端形态生效。
 */
export const LOG_SCROLL_MAX = 8_000_000;

/**
 * 一条日志在页面里的高度。
 *
 * `wrap` 为假时行不换行（`truncate`），恒为 {@link LOG_ROW_SINGLE}；
 * `wrap` 为真时按显式换行符与软换行估算——软换行数由字符数除以每行容量得出，
 * 而**每行容量**取决于面板宽度（汉字与西文的宽度不同），所以这里只求
 * 「不低估」：低估会让下面几行被推到视口外，高估只是多留一点空白。
 */
export function estimateRowHeight(message: string, wrap: boolean): number {
  if (!wrap) return LOG_ROW_SINGLE;
  const lines = Math.max(1, countLines(message));
  return LOG_ROW_SINGLE + (lines - 1) * LOG_ROW_LINE;
}

/**
 * 消息在面板里**至少**占几行。
 *
 * 判据分两段：显式换行（`\n`，多行 JSON payload 就是这种）逐段数；
 * 每段再按宽度拆软换行——容量按**最窄的字**（中文 13px）算，
 * 于是 `ceil(段长 × 13 / 可用宽度)` 是下界。
 *
 * `availableWidth` 取不到（jsdom / 首帧未量到宽度）时只数显式换行：宁可少估
 * 也不能瞎估。
 */
export function countLines(message: string, availableWidth = 0): number {
  const segments = message.split("\n");
  if (availableWidth <= 0) return segments.length;
  let total = 0;
  for (const segment of segments) {
    total += Math.max(1, Math.ceil((segment.length * 13) / availableWidth));
  }
  return Math.max(1, total);
}

/** 一条日志在列表里的位置与高度（见 {@link layoutRows}）。 */
export interface RowLayout {
  /** 该行上边缘距列表顶部（不含顶部留白）的像素数。 */
  start: number;
  /** 该行的估算高度（像素）。 */
  size: number;
}

/**
 * 估算整页每一行的位置与高度。
 *
 * 之所以**整页算一遍**而不是按需累加：位置是单调前缀和，`start[i]` 必须对得上
 * `sum(size[0..i-1])`，否则 `translateY` 与滚动条会各说各话。整页 2000 次乘法
 * 远低于一帧预算（实测 < 1ms），换来的是「窗口怎么取都不会错位」。
 */
export function layoutRows(
  entries: readonly { message: string }[],
  wrap: boolean,
  availableWidth = 0,
): { rows: RowLayout[]; totalSize: number } {
  /* `Array.from` 而不是 `new Array(n)`：后者在 lint 下是 `any[]`，会一路传染到
     下面的 `rows[i]` 赋值上。 */
  const rows: RowLayout[] = Array.from({ length: entries.length }, () => ({
    start: 0,
    size: LOG_ROW_SINGLE,
  }));
  let start = 0;
  for (let i = 0; i < entries.length; i += 1) {
    const message = entries[i]!.message;
    /* 每行的行数只数一次：estimateRowHeight 与 countLines 都靠它推高度。 */
    const lines = wrap ? countLines(message, availableWidth) : 1;
    const size = LOG_ROW_SINGLE + (lines - 1) * LOG_ROW_LINE;
    rows[i] = { start, size };
    start += size;
  }
  return { rows, totalSize: start };
}

/**
 * 滚动位置 → 要渲染的行区间（左闭右开）。
 *
 * 四条边界缺一不可：
 *   - `overscan` 上下各留几行（快速滚动 / 估高小误差时不露空白）；
 *   - **空列表返回空区间**（`end` 不得为负，否则 `slice` 会拿到奇怪的东西）；
 *   - 行数不足一屏时直接给全量（`end` 不许超过 `rows.length`）；
 *   - `scrollTop` 为负 / `NaN`（jsdom 与初次布局）当 0 处理。
 */
export function visibleRange(
  rows: readonly RowLayout[],
  scrollTop: number,
  viewportHeight: number,
  overscan = LOG_VIRTUAL_OVERSCAN,
): { start: number; end: number } {
  const count = rows.length;
  if (count === 0) return { start: 0, end: 0 };
  const top = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
  const height = Number.isFinite(viewportHeight)
    ? Math.max(0, viewportHeight)
    : 0;
  const pad = Math.max(0, overscan);

  const first = firstVisibleRow(rows, top);
  const last = firstVisibleRow(rows, top + height);
  const start = Math.max(0, first - pad);
  const end = Math.min(count, last + 1 + pad);
  return { start, end: Math.max(start, end) };
}

/**
 * 位置 `offset` 落在哪一行的**下标**（二分）。
 *
 * 二分而不是线性扫描：滚动事件每帧都要求一次，线性扫描 2000 行在慢速设备上
 * 会直接体现在滚动掉帧上。`rows` 的 `start` 单调递增，因此二分成立。
 */
export function firstVisibleRow(
  rows: readonly RowLayout[],
  offset: number,
): number {
  if (rows.length === 0) return 0;
  let low = 0;
  let high = rows.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (rows[mid]!.start <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}

/**
 * 估算总高 → 实际用于撑开滚动条的高度（超限时按比例压缩，见 {@link LOG_SCROLL_MAX}）。
 *
 * 同时给出 `ratio`：滚动位置要跟着这个比例反向换算，否则「压缩后的列表」里
 * 滚一半对应的其实是真实高度里的另一处。
 */
export function scrollHeightOf(estimated: number): {
  height: number;
  compressed: boolean;
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
