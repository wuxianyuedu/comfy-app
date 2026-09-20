// ── 「把一组值写成查询串」的唯一出口（规范 16 §16.2.4.32）────────────────────
//
// 按**形态**扫描时撞出来的账：全库有 **两种写法并存** —— 一半落点用
// `new URLSearchParams({...})`（`log-file-client` 的会话列表、
// `materials-client` 的素材列表、`login` 读 `callbackUrl`、几处测试），
// 另一半手拼模板串：`` `/api/images?filename=${encodeURIComponent(name)}&type=input` ``。
//
// 两种写法**都编译、都运行、类型都对**，差别在四个语义决定上：
//
//   ① **哪些参数会被丢掉** —— `URLSearchParams` 对 `undefined` 会写成字符串
//      `"undefined"`（不是省略！），所以「可选参数」那几处还得自己
//      `if (x) params.set(…)` 包一层；手拼的落点则用 `${x ? `&y=${…}` : ""}`
//      三元，**两处各写一遍同一个判据**，且判据不一样（有的是 `?:`、有的是 `if`）。
//   ② **空串算不算「有这个参数」** —— `params.set("q", "")` 会产出
//      `?q=`（服务端读到的是一次空搜索），而手拼的 `if (q)` 会**整个省掉**
//      这个键。两种行为在服务端是两条不同的分支（`/api/materials` 的
//      `q` 为空时回落按分类取），而界面上看不出差别。
//   ③ **重复键怎么办** —— `URLSearchParams` 的 `append` 会产出 `?a=1&a=2`，
//      `set` 会覆盖；手拼的落点压根表达不了这一层。
//   ④ **编码是谁的责任** —— 手拼的落点里 `encodeURIComponent` **漏一处**
//      就是一个静默 400/404：素材文件名带 `#`、子目录名带 `&` 时，
//      请求会打到另一个端点上。收口前全库 12 处手拼里，有 3 处漏了编码
//      （`/api/logs/current` 的 `offset` 是数字所以看不出问题，
//      `/api/llm/models` 的 `provider` 是枚举也看不出 ——
//      真正会出问题的是 `filename` / `subfolder` / `file` 这几处带用户输入的）。
//
// 也就是说 —— **「哪些参数会被送出去、送成什么样」取决于它是哪一处拼的**。
// 这类差异没有报错、没有告警（服务端收不到某个键时的行为是它自己的默认值）。
//
// ## 口径（本文件是全库唯一的定义处）
//
// · **`undefined` / `null` → 省略整个键**（不写 `"undefined"`、不写空值）；
// · **空串 → 省略**（默认）—— 空串与「不传」在服务端是同一个意思，
//   显式写出来只会让 URL 变长、让日志里出现 `?q=` 这种读不出意图的东西。
//   确实要「显式空值」的落点用 `keepEmpty: true`（这是域决定，必须显式）；
// · **值一律 `encodeURIComponent`**（编码是出口的责任，调用处不可能漏）；
// · **重复键 → 数组值**（`{ tag: ["a", "b"] }` → `tag=a&tag=b`）；
// · **布尔 → `"true"` / `"false"`**（不写 `"1"`/`"0"`：那与数字 1 / 0 混淆）；
// · **数字 → 十进制字符串**（`0` 是**合法值**，不会被当成缺值 ——
//   与 `~/lib/display-value` 的 `0` 判据同源）。
//
// 与 `next/navigation` 的 `useSearchParams()` 的分工：那个是**读**（浏览器地址栏
// 当前的查询串），本模块是**写**（要发给某个端点的查询串）。两者不同源 ——
// 这个模块不碰 DOM，可在服务端与脚本里直接用。

/** 查询串里允许的值类型。`undefined` / `null` 表示**省略这个键**。 */
/** 单值的合法载荷（`null` / `undefined` 表示省略这个键）。 */
export type QueryScalar = string | number | boolean | null | undefined;

export type QueryValue = QueryScalar | readonly QueryScalar[];

export interface BuildQueryOptions {
  /**
   * 空串是否也算「有这个参数」。
   *
   * 默认 `false`（省略）—— 空串与「不传」在服务端是同一个意思。显式开它
   * 只为一类落点：服务端把 `""` 当**一次有效输入**（如「搜索空关键字」
   * 表示清空筛选），而此时 URL 里必须留下那个键。
   */
  keepEmpty?: boolean;
}

/** 单值 → 字符串；不该写进查询串的返回 `null`（表示省略）。 */
function encodeValue(
  value: string | number | boolean,
  keepEmpty: boolean,
  key: string,
): string | null {
  if (typeof value === "string") {
    if (value === "" && !keepEmpty) return null;
    return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  }
  /* `0` 与 `false` 是**真实的值**，不是缺值（与 §16.2.4.20 的 `displayValue`
   * 口径同源）—— `?offset=0` 是「从头上读」，省略它会让服务端按自己的默认
   * 游标回答，那是另一件事。 */
  return `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`;
}

/**
 * 一组键值 → 查询串（**不带** 前导 `?`）。
 *
 * 典型调用形态：可选参数直接写 `undefined`，出口会省略整个键（而不是写成
 * 字符串 `"undefined"`）；数字 `0` 会被保留（它不是缺值）—— 这两条差别
 * 就是收口前 `URLSearchParams` 与手拼模板串最大的分歧。
 * 具体落点见 `~/lib/media/media-url` 的 `comfyImageUrl` 与
 * `~/lib/log/log-file-client` 的 `fetchFileLogSlice`。
 *
 * 返回空串表示「一个参数都没有」—— 调用处据此决定要不要带 `?`：
 * `` `/api/x${qs ? `?${qs}` : ""}` ``。这条也收在 {@link withQuery} 里。
 */
export function buildQueryString(
  params: Record<string, QueryValue>,
  { keepEmpty = false }: BuildQueryOptions = {},
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      /* 重复键：每个元素各出一段（`tag=a&tag=b`）。元素可能是 `null` /
       * `undefined`（调用处传的是稀疏数组），按单值口径省略。 */
      for (const item of value as readonly QueryScalar[]) {
        if (item === null || item === undefined) continue;
        const part = encodeValue(item, keepEmpty, key);
        if (part !== null) parts.push(part);
      }
      continue;
    }
    const part = encodeValue(
      value as string | number | boolean,
      keepEmpty,
      key,
    );
    if (part !== null) parts.push(part);
  }
  return parts.join("&");
}

/**
 * 把查询串接到路径上（**带** `?`，没有参数时原样返回路径）。
 *
 * 这一条收口的是「`?` 该不该出现」—— 收口前手拼的落点在这里有三套写法：
 * 无条件带 `?`（`?${qs}`）、三元判空（`${qs ? `?${qs}` : ""}`）、
 * 以及**写死一个必有参数**之后才拼其余的（`?source=${s}&offset=${o}${boot}`，
 * 而 `boot` 自己带 `&`）。第三套的含义最容易被读错：它假设 `source` 恒有值。
 */
export function withQuery(
  path: string,
  params: Record<string, QueryValue>,
  options?: BuildQueryOptions,
): string {
  const qs = buildQueryString(params, options);
  return qs ? `${path}?${qs}` : path;
}

/**
 * 读一个查询串里的值（`?a=1&b=2` 或 `a=1&b=2` 都接受）；没有该键返回 `null`。
 *
 * **只给「读当前地址栏」之外的落点用**：在 App Router 里读地址栏应当走
 * `useSearchParams()`（`next/navigation`），那是框架的契约（它处理服务端渲染、
 * 挂载时的一致性）。本函数面向「手上已经有一个查询串字符串」的场合 ——
 * 例如从日志行里解出某个端点的参数，或在测试里读回自己拼出来的串。
 *
 * 键不存在与「键存在但值为空串」分得开（`null` / `""`）—— 与
 * `~/lib/browser-storage` 的 `readStorageItem` 同款判据（取返回值、不取解析结果）。
 */
export function readQueryParam(query: string, key: string): string | null {
  const start = query.startsWith("?") ? 1 : 0;
  for (const pair of query.slice(start).split("&")) {
    if (pair === "") continue;
    const eq = pair.indexOf("=");
    const rawKey = eq < 0 ? pair : pair.slice(0, eq);
    if (decode(rawKey) !== key) continue;
    return eq < 0 ? "" : decode(pair.slice(eq + 1));
  }
  return null;
}

/** 宽容解码：坏转义（`%zz`）原样返回，不抛 —— 查询串来自别处时不该崩。 */
function decode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}
