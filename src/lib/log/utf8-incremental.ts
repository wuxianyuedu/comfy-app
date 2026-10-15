/* ── 增量字节流 → 文本：跨块的多字节字符不许被劈成两半（纯函数）────────
 *
 * 用途：**跟随一个还在被写的日志文件**（tails / 增量读取）。读侧只知道
 * 「上次读到第几字节」，而 UTF-8 的一个码位占 1~4 字节 —— 一次读到的区间
 * 完全可能从某个中文字符的**中间**开始、或停在某个字符的中间。对这样的切片
 * 各自做一次 `toString("utf-8")`，两端各得到一串 U+FFFD（`�`），
 * 也就是用户看到的「乱码」。
 *
 * 现场（ISSUE #1959 的截图）：ComfyUI 的保活输出按 1s 节拍被增量跟进到
 * `comfyui-runtime.log`，而 ComfyUI 正以远高于 1s 的频率刷中文行 ——
 * 每拍切一次、每次都可能在字符中间切断，于是面板上的中文被啃成
 * `褰撳墠鍔犺浇` / `�` 这类样子。
 *
 * 判据分两件，各自独立可断言：
 *   ① 「末尾还剩几个不完整字节」—— `incompleteTailLength`，纯字节运算；
 *   ② 「把上一轮的残余拼回来再解」—— `decodeIncremental`，返回文本 + 新残余。
 *
 * 为什么不做「按行切」就完事：按行切只能保证**不切在换行上**，切在一个中文字
 * 的中间照样出乱码 —— 而 ComfyUI 的长中文行（进度条、模型名）中间没有任何
 * 换行可供取巧。
 *
 * 不做有损兜底：真正的非法字节（不是「被截断」而是「根本不是 UTF-8」）由
 * `TextDecoder({fatal:false})` 的默认替换行为处理 —— 那种字节无论怎么拼都是
 * 乱码，本模块的职责只是**不自己制造**乱码。
 */

/** 一个码位在 UTF-8 下的字节数（看**首字节**的前导 1 的个数）。 */
function expectedLength(lead: number): number {
  if (lead < 0x80) return 1; // 0xxxxxxx ASCII
  if ((lead & 0xe0) === 0xc0) return 2; // 110xxxxx
  if ((lead & 0xf0) === 0xe0) return 3; // 1110xxxx（中文在此）
  if ((lead & 0xf8) === 0xf0) return 4; // 11110xxx（emoji）
  /* 0x80~0xBF 是续字节、不该出现在这里；0xF8+ 不是合法 UTF-8 首字节。
   * 两者都按 1 处理：让它们原样交给解码器（会变成替换字符，但**归因正确** ——
   * 那是输入本来就坏，不是我们切坏的）。 */
  return 1;
}

/**
 * 这段字节的**末尾还剩几个字节凑不出一个完整字符**（0~3）。
 *
 * 返回值就是「该留给下一轮拼回来」的长度：调用方只解 `buf` 的前
 * `buf.length - tail` 个字节，把最后 `tail` 个字节存下来。
 */
export function incompleteTailLength(buf: Uint8Array): number {
  const n = buf.length;
  if (n === 0) return 0;
  /* 从末尾往回找首字节，最多回看 3 个（UTF-8 最长 4 字节）。
   * 全是续字节（0x80~0xBF）时说明切在了字符中间，回看会走到 lead 上。 */
  const maxBack = Math.min(4, n);
  for (let back = 1; back <= maxBack; back++) {
    const idx = n - back;
    const byte = buf[idx];
    /* `idx` 由 `back <= min(4, n)` 保证在界内，但**不写 `!`**：非空断言是本仓
     * 的硬闸（脚本 check-non-null-assertions），而这里一个显式守卫的成本与一个
     * `!` 相当、却把「为什么它一定在」写在了判据里。 */
    if (byte === undefined) break;
    if ((byte & 0xc0) === 0x80) continue; // 续字节，继续往回找
    const need = expectedLength(byte);
    /* need > back 表示「这个字符还差几个字节没到」——本段末尾那 `back`
     * 个字节（含这个首字节）整块留给下一轮。 */
    return need > back ? back : 0;
  }
  /* 回看 4 个全是续字节：输入不是合法 UTF-8（正常最多 3 个续字节）。
   * 当作「没有可留的尾巴」，交给解码器如实报坏 —— 不在这里编一个长度。 */
  return 0;
}

/** 一次增量解码的结果：可立即渲染的文本 + 留给下一轮的残余字节。 */
export interface IncrementalDecode {
  /** 本段能确定解出的文本（不含被截断的尾字符）。 */
  text: string;
  /** 上一轮遗留 + 本轮末尾被截断的字节，**下一轮拼接时传回来**。 */
  carry: Uint8Array;
}

/**
 * 把「上一轮的残余」与「本轮新读到的字节」拼起来解，并把新的残缺尾巴留下。
 *
 * 用法（跟随一个正在被写的文件）：
 * ```ts
 * let carry = new Uint8Array(0);
 * // 每拍：读出 start..size 的字节 newBytes
 * const { text, carry: next } = decodeIncremental(carry, newBytes);
 * carry = next;
 * // text 就是本拍新增的、字符完整的文本
 * ```
 */
export function decodeIncremental(
  carry: Uint8Array,
  next: Uint8Array,
  decode: (bytes: Uint8Array) => string = (b) =>
    new TextDecoder("utf-8").decode(b),
): IncrementalDecode {
  const merged = carry.length === 0 ? next : concatBytes(carry, next);
  const cut = merged.length - incompleteTailLength(merged);
  return {
    text: decode(merged.subarray(0, cut)),
    carry: merged.slice(cut),
  };
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
