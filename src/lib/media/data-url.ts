// ── 「拼一个 data: URL / 读回它的载荷」的唯一出口（规范 16 §16.2.4.56）────
//
// 按**形态**扫出来的账：`data:${mime};base64,${…}` 在全库手拼了 **3 处**
// （`workshop/media-source.server` / `workshop/api-channel-shared` /
// `server/workshop/api-channel`），而读回来的一侧有 **6 处**各写一遍
// 「从头开始找第一个逗号，后面的就是 base64」。
//
// 差的是**判据**不是风格 —— 每一处都编译、都运行、类型都对：
//
//   ① **拼的时候 mime 从哪来** —— 两处从 `Buffer` 的来源推（响应头 /
//      扩展名），一处**默认写死 `"image/png"`**（上游没给线索时的兜底）。
//      于是同一个上游响应在「走 media-source」与「走 api-channel」两条路径
//      上，内联 data URL 的 MIME 可能一个是写死的 `image/png`、
//      一个是真实的 `image/webp`
//   ② **读的时候怎么切** —— 三处写法各不相同：
//      · `src.slice(src.indexOf(",") + 1)`（两处）—— **不检查逗号是否存在**，
//        没有逗号时 `indexOf` 返回 `-1`，`slice(0)` 把**整个 data URL**
//        当 base64 交给解码器 —— 结果是静默解出垃圾字节
//        （base64 解码器会跳过非法字符），而不是报错
//      · `url.includes(",") ? (url.split(",")[1] ?? "") : ""`（一处）——
//        至少判了有没有逗号，但切法是把整个串 split 一遍
//      · 只有 `media-source.server` 真去读了 `;base64` 之前的 meta，
//        也因此只有它能给出「这个 data URL 的 MIME 是什么」
//   ③ **非 base64 的 data URL 怎么办** —— `data:text/plain,hello`
//      （不含 `;base64`）是**合法的** data URL，载荷是百分号编码的文本
//      而不是 base64。三处读取实现都无条件按 base64 解 —— 遇到它静默出乱码
//
// 口径（本文件是全库唯一的定义处）：
//   · **`data:` 前缀与 `;base64,` 的切分只在这里出现**；别处一律调本模块
//   · **读回的 MIME 与载荷分开给**（`parseDataUrl` 给 `{ mime, base64 }`）
//     —— 只要 base64 的调用处不必自己从头切一遍
//   · **畸形输入返回 `null`，不静默解垃圾**：`Buffer.from(垃圾, "base64")`
//     不报错（它跳过非法字符），所以「有没有逗号」这件事必须显式判
//   · **非 base64 的 data URL 显式拒绝**（本仓库没有落点用到它；真要支持
//     时在这里加一条分支，而不是让每个调用处各判一次）
//
// 与 `~/lib/file-io` 的分工：那个管「用户选的 `File` → data URL」
// （浏览器侧读文件，要 `FileReader`），本模块管「已经有字节 / 已经有一串
// data URL 之后怎么编码与解码」（纯算术）。两者方向相反。

/** data URL 的组成：MIME 与 base64 载荷（不含 `;base64` 之前的那段 meta）。 */
export interface ParsedDataUrl {
  /** `data:` 与第一个 `,` 之间的 MIME（无声明时为 `""`）。 */
  mime: string;
  /** 逗号之后的 base64 载荷（原样，未解码）。 */
  base64: string;
}

/** data URL 的前缀。收口前它以字面量出现在 9 处（写的一侧 3、读的一侧 6）。 */
export const DATA_URL_PREFIX = "data:";

/** 判断一个字符串是不是 data URL。 */
export function isDataUrl(value: string): boolean {
  return value.startsWith(DATA_URL_PREFIX);
}

/**
 * 把字节拼成 base64 的 data URL。
 *
 * `mime` 由调用处决定（那是**域判据**：上游响应头给的是事实、
 * `"image/png"` 是兜底）—— 本函数只保证 `data:` 前缀与 `;base64,`
 * 的分隔符只有一处拼法。
 *
 * ```ts
 * toDataUrl(buffer, "image/webp")  // 产物："data:image/webp;base64,UklGR…"
 * ```
 */
export function toDataUrl(bytes: Uint8Array, mime: string): string {
  return `${DATA_URL_PREFIX}${mime};base64,${toBase64(bytes)}`;
}

/**
 * 把**已有的 base64 载荷**包成 data URL（不再编码一遍）。
 *
 * 这是上游直接回 `b64_json` 那一档：载荷已经是 base64 字符串，
 * 缺的只是 `data:<mime>;base64,` 这段前缀。与 `toDataUrl` 的差别是入参
 * 形态（字符串 vs 字节），两者共用同一处前缀拼法。
 *
 * ```ts
 * wrapBase64("AAAA", "image/png")  // 产物："data:image/png;base64,AAAA"
 * ```
 */
export function wrapBase64(base64: string, mime: string): string {
  return `${DATA_URL_PREFIX}${mime};base64,${base64}`;
}

/**
 * 把字节编成 base64（不拼 data URL 前缀）。
 *
 * `Buffer` 只在服务端存在，浏览器侧走 `btoa` —— 两个宿主都覆盖到，
 * 调用处不必判环境（收口前**三处写入全在服务端**，但读取侧的
 * `character-portrait-client` 在浏览器里，故这里两侧都给）。
 */
export function toBase64(bytes: Uint8Array): string {
  /* Node / 服务端：`Buffer` 走原生实现（大图快一个数量级）。 */
  const bufferCtor = (
    globalThis as {
      Buffer?: { from(b: Uint8Array): { toString(enc: string): string } };
    }
  ).Buffer;
  if (bufferCtor) return bufferCtor.from(bytes).toString("base64");
  /* 浏览器：分块 `btoa`，避免 `String.fromCharCode(...bytes)` 在大数组上
   * 触发「参数过多」的 RangeError（24MB 上限的图片轻松越过该阈值）。 */
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * 判定一个 media 引用是不是内联的 data URL（`resolveMediaBytes` /
 * `fetchToBuffer` / `localizePortraitImage` 三处各判一遍的同一个问题）。
 *
 * 与 `isDataUrl` 的差别只是**语义命名**：这一档问的是「要不要走网络」，
 * 读作 `if (isInlineMedia(ref)) { …内联分支… } else { …fetch… }`。
 */
export function isInlineMedia(reference: string): boolean {
  return isDataUrl(reference);
}

/**
 * 解析 data URL，取出 MIME 与 base64 载荷。
 *
 * **畸形输入返回 `null`**（缺 `data:` 前缀、缺逗号、`;base64` 载荷为空）——
 * 收口前那几处 `slice(indexOf(",") + 1)` 在缺逗号时会把整串当 base64，
 * 静默解出垃圾字节；调用处拿到 `null` 就能给一句可读的错误。
 *
 * 非 base64 的 data URL（`data:text/plain,hello`）同样返回 `null`：
 * 它的载荷是百分号编码的，按 base64 解只会得到乱码。
 *
 * ```ts
 * parseDataUrl("data:image/png;base64,AAAA")  // 取到 { mime, base64: "AAAA" }
 * parseDataUrl("data:image/png,AAAA")         // 给 null（不是 base64 形态）
 * parseDataUrl("not-a-data-url")              // 给 null（根本不是 data URL）
 * ```
 */
export function parseDataUrl(value: string): ParsedDataUrl | null {
  if (!isDataUrl(value)) return null;
  const comma = value.indexOf(",");
  if (comma < 0) return null;
  const meta = value.slice(DATA_URL_PREFIX.length, comma);
  if (!meta.toLowerCase().endsWith(";base64")) return null;
  const base64 = value.slice(comma + 1);
  /* 空载荷与「逗号后面什么都没有」是同一件事，但都不该被当成合法 data URL。 */
  if (base64 === "") return null;
  const mime = meta.slice(0, -";base64".length);
  return { mime: mime || "application/octet-stream", base64 };
}

/**
 * 只取 data URL 的 base64 载荷；非 base64 形态返回 `null`。
 *
 * 这是「只要载荷、不要 MIME」那一档（`fetchToBuffer` / 视频首帧落盘 /
 * 浏览器侧转 `File`）—— 与 {@link parseDataUrl} 同一份判据。
 */
export function base64PayloadOf(value: string): string | null {
  return parseDataUrl(value)?.base64 ?? null;
}
