/**
 * `Range` 请求头的解析（RFC 7233 的**单档**字节范围）。
 *
 * 为什么要有这一层：产物读取口（`/api/generated/[...path]`）是视频与大图的唯一出口，
 * 而浏览器拖进度条发的就是 `Range: bytes=…`。没有这套判据时只有两种坏写法 ——
 * 要么每个请求把整份文件读进内存再切（拖一条 300 MB 的成片 = 每次 seek 全量读盘），
 * 要么在 handler 里就地正则一遍（下一个需要 Range 的入口照着再抄一份，§12.12）。
 *
 * 三条口径写在返回值形状里，调用方不必再记协议：
 *  · `full` —— **没有 Range**，或这条头**不符合我们支持的形状**（多档、非 `bytes=`、
 *    语法不认识、`first > last`）。按 RFC 这些是「无效的范围」，客户端要的其实是整份，
 *    所以**忽略它并回 200**，别回 416 —— 回 416 会让一个我们根本没拒绝的请求变成播放失败。
 *  · `partial` —— 合法的一档，`endInclusive` 是**闭区间**（与 HTTP 与 `fs.read` 的
 *    习惯一致：`0-0` 就是 1 个字节）。已经按 `size` 收过边界（RFC 要求服务端裁剪）。
 *  · `unsatisfiable` —— 语法完全合法但**当前这份文件满足不了**（起点已在文件末尾之后、
 *    或文件是 0 字节）。这一支才是 416，并配一条只写「总长未知起点」的 `Content-Range`
 *    （拼法见 `contentRangeHeader()`，两处共用一份形状）。
 *
 * 不支持多档 `bytes=0-1,2-3`（那要 `multipart/byteranges` 与 boundary）：本应用的
 * 消费者是浏览器媒体元素与图片，它们都只发单档；真要支持时改这一层，别在调用点分叉。
 *
 * 为什么住在 `src/server/lib` 而不是 `src/lib`：它解析的是**进来的请求头**，与
 * `request-body.ts`（解析请求体）、`error-response.ts`（错误出口）同族 —— 那两份都在这里。
 * `src/lib` 的根目录只放跨端共用的顶层单例（§18.14 的子域纪律），而浏览器永远不会
 * 需要解析自己的请求头。
 */

import "server-only";

/** 一段字节窗口；`start` 与 `endInclusive` 都是闭区间、从 0 计数。 */
export type ByteWindow = { start: number; endInclusive: number };

/** 见文件头那三条口径。 */
export type ByteRangeVerdict =
  | { kind: "full" }
  | { kind: "partial"; window: ByteWindow }
  | { kind: "unsatisfiable" };

const FULL: ByteRangeVerdict = { kind: "full" };

/** 只认非负十进制整数；带 `+`、小数、空格、符号的一律算「这条 Range 我们不解析」。 */
function digits(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * 解析 `Range: bytes=…`。
 *
 * @param header 请求头的原文；`null`（没有这条头）与空串同样按整份处理
 * @param size 目标文件的实际字节数（必须由调用方给 —— 这里不碰磁盘）
 */
export function resolveByteRange(
  header: string | null,
  size: number,
): ByteRangeVerdict {
  const value = header?.trim() ?? "";
  if (value === "") return FULL;
  if (!/^bytes=/i.test(value)) return FULL;
  // 多档一律不解析（见文件头）。逗号在这里只有一种含义：客户端要了多段。
  const spec = value.slice("bytes=".length).trim();
  if (spec === "" || spec.includes(",")) return FULL;

  /* 形状在这里一次判死：两端都只许是「一串十进制数字」或「整段缺省」。
   * `bytes=1-2-3`、`bytes=+1-9`、`bytes=1.5-9`、`bytes=abc`、`bytes=1 - 9` 全落在
   * 这一条上 —— 不认识就回整份，不去猜客户端想要什么。
   *
   * 用「按第一个 `-` 切 + 两端各自校验」而不是一个 `^(\d*)-(\d*)$` 正则：
   * 正则那份要给 `shape[1]` 兜一个永远走不到的 `?? ""`（两个可选组只要匹配就都是字符串），
   * 而一条**不可达的分支**挂在覆盖率上就是长期欠账。这里每一支都真能走到。 */
  const dash = spec.indexOf("-");
  if (dash < 0) return FULL;
  const firstRaw = spec.slice(0, dash);
  const lastRaw = spec.slice(dash + 1);
  // 还有第二个 `-`（`bytes=1-2-3`）：不是单档的形状，也不认识。
  if (firstRaw.includes("-") || lastRaw.includes("-")) return FULL;
  // `bytes=-`：两头都缺省，等于什么都没要（不是「整个文件」，那客户端直接不发 Range 就行）。
  if (firstRaw === "" && lastRaw === "") return FULL;
  const first = digits(firstRaw);
  const last = digits(lastRaw);

  // 后缀形式 `bytes=-500`：取末尾 500 个字节，与「起点 0、终点 500」不是同一件事。
  // 起点**整段缺省**才算后缀（见上面那条形状判据）。
  if (firstRaw === "") {
    // 后缀形式里那个数大到不再是精确整数（`bytes=-999…`）：按「不认识」回整份，
    // 与起点那一侧同口径 —— 不拿一个绕回来的数字去决定读哪一段。
    if (last === null) return FULL;
    // `bytes=-0` 要 0 个字节、0 字节的文件什么档都给不出 —— 两支都是「满足不了」。
    if (last === 0 || size === 0) return { kind: "unsatisfiable" };
    return {
      kind: "partial",
      window: { start: Math.max(size - last, 0), endInclusive: size - 1 },
    };
  }
  // 超出安全整数的数字（`bytes=0-99999999999999999999`）算不认识，
  // 不回一个绕回来的窗口 —— JS 的 Number 在这里已经不再是精确整数了。
  if (first === null) return FULL;
  /* `first > last` 按 RFC 是**语法无效**的范围（跟这份文件多大无关），整条 Range
   * 头就当没发过。这一条必须排在下面那条按 size 的判定**之前**：否则 `bytes=500-100`
   * 在一个 10 字节的文件上会被判成 416 —— 把一个我们根本没理解的请求，
   * 说成「你要的东西不存在」，那是两种不同的错。 */
  if (last !== null && last < first) return FULL;
  // 起点已经在文件末尾之后（含 0 字节的文件）：语法完全合法、这份东西满足不了，
  // 这才是 416 该出现的地方（与上面「不认识就回整份」是两件事）。
  if (first >= size) return { kind: "unsatisfiable" };
  // `bytes=100-`：到文件末尾。
  if (lastRaw === "")
    return {
      kind: "partial",
      window: { start: first, endInclusive: size - 1 },
    };
  if (last === null) return FULL;
  // 终点超出文件长度时裁到末尾（RFC 要求服务端收边界，不许回一段不存在的字节）。
  return {
    kind: "partial",
    window: { start: first, endInclusive: Math.min(last, size - 1) },
  };
}

/** `Content-Range` 的唯一拼法：`partial` 给「起点-终点/总长」，
 *  而 416 那一支按 RFC 只给「星号 / 总长」（窗口传 `null` 就是这个形状）。 */
export function contentRangeHeader(
  window: ByteWindow | null,
  size: number,
): string {
  if (!window) return `bytes */${size}`;
  return `bytes ${window.start}-${window.endInclusive}/${size}`;
}
