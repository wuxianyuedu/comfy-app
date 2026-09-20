// ── 「把一段路径拼成可展示的相对路径 / 超长时省略中段」的唯一出口（规范 16 §16.2.4.60）──
//
// 按**形态**扫出来的账（ISSUE #672）：同一件「把一条文件系统路径变成界面上的一行」
// 在全库散着三种各写各的写法，而它们对三件事各判各的：
//
//   · **相对谁** —— `path.relative(REPO_ROOT, …)` / `path.relative(LOG_ROOT, …)` /
//     `sum.slice("ComfyUI-".length)` / 直接原样。同一个文件在一处显示
//     `log/exports/xxx.txt`、在另一处显示绝对路径 `F:\AI\...\log\exports\xxx.txt`；
//   · **分隔符** —— `.replace(/\\/g, "/")` ×8、`.split(path.sep).join("/")` ×2、
//     其余不归一。同一个 Windows 路径在一处是 `a/b`、在另一处是 `a\b`，
//     而用户会把界面上的这行文本**复制到终端**里去用；
//   · **超长怎么办** —— 视图侧清一色 `truncate`（CSS `text-overflow: ellipsis`）
//     **只留头部**。而路径的**语义在尾部**（哪个文件 / 哪个包）：`truncate` 之后
//     用户看到的是 `F:\AI\ComfyApp\src\components\studio\workflo…` ——
//     被切掉的恰好是他要看的那一段。全库唯一的「保留尾部」写法在
//     `SettingsParts` 里，且只保留最后 2 段、不含省略标记。
//
// 收口口径（与 §16.2.4.48 的文本截断同款）：**上限与保留几段是调用处的域决定**，
// 但「相对谁 / 分隔符归一 / 省略的是中段」这三件事只该有一处定义。因此这里给的是
// 一组**能说清差异**的落点：`toDisplayPath`（rel + 归一）、`stripPathPrefix`
//（剥固定前缀）、`lastSegments`（取末 N 段）、`ellipsisMiddle`（中段省略）。
//
// 一句话判据：**要「给用户看的一条路径」用本模块；要「这条路径能不能用」是别的账**
//（那走 `~/lib/safe-name` 的 `sanitizeFileName`）。

/**
 * 把一段路径的相对部分与分隔符一次归一成**展示形态**。
 *
 * - `base` 给了就取相对它的一截（拿不到相对关系时**原样返回**，不抛 ——
 *   展示层不该因为「这台机器上两者不同源」而炸）；
 * - 反斜杠一律换成正斜杠（`/`）：界面上的这行文本会被用户复制到终端 / URL /
 *   `vscode://file/` 里去用，`\` 在那一侧是转义符而不是分隔符；
 * - 前导 `./` 一并剥掉（`path.relative` 在同一目录下会给 `""`，
 *   在子目录下不会给 `./`，但调用处传进来的可能带）。
 *
 * **不**在这里限制长度 —— 上限是调用处的域决定（日志面板与包卡片的宽度不同），
 * 要截就先 `ellipsisMiddle` 或 `lastSegments`。
 *
 * ```ts
 * // 相对某个根：给相对那一段，分隔符归一
 * toDisplayPath("F:\\AI\\ComfyApp\\log\\exports\\a.txt", "F:\\AI\\ComfyApp"); // 相对根
 * // 不给根：只归一分隔符
 * toDisplayPath("src/components/studio/x.tsx"); // 结果同原串的正斜杠形态
 * ```
 */
export function toDisplayPath(
  raw: string | null | undefined,
  base?: string | null,
): string {
  const s = normalizeSlashes(raw);
  if (!s) return "";
  if (!base) return s;
  const b = normalizeSlashes(base).replace(/\/+$/, "");
  if (!b) return s;
  /* 只在**确实是这个前缀**时剥 —— 不做 `path.relative` 的 `..` 推导：
   * 展示层要的是「相对这台机器上的哪个根」，`../../..` 那一串对用户没有信息量，
   * 而且它在两个不同源的路径上会是纯噪声。剥不动就原样返回。 */
  if (s === b) return "";
  if (s.startsWith(b + "/")) return s.slice(b.length + 1);
  return s;
}

/**
 * 剥掉一个**固定**前缀（如 `"ComfyUI-"` 包名前缀、`"data:image/png;base64,"` 之外
 * 的那些字面前缀）。命中才剥，未命中原样返回。
 *
 * 与 {@link toDisplayPath} 的分工：那个剥的是「一台机器上的根目录」，本函数剥的是
 * 「一个约定的命名前缀」—— 不需要分隔符语义，也不需要归一。
 */
export function stripPathPrefix(
  raw: string | null | undefined,
  prefix: string,
): string {
  if (!raw) return "";
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
}

/**
 * 取路径的**末 `n` 段**（`n ≤ 0` 给空串）。
 *
 * 这是「路径太长、而我只关心它是哪个文件 / 落在哪个目录」那一档的标准手法 ——
 * 比字符级中段省略更符合直觉：**段**是不会被切一半的语义单位。
 * `SettingsParts` 此前手写 `split(/[\\/]/).slice(-2).join("/")`，本函数是它的
 * 收口（分隔符归一后同样给 `/`）。
 *
 * ```ts
 * // 取末两段（路径太长时只留尾部那截）
 * lastSegments("a/b/c/d.ts", 2); // 给 "c/d.ts"
 * lastSegments("a/b/c/d.ts", 0); // 给空串
 * ```
 */
export function lastSegments(
  raw: string | null | undefined,
  n: number,
): string {
  const s = normalizeSlashes(raw);
  if (!s || n <= 0) return "";
  const parts = s.split("/").filter(Boolean);
  if (parts.length <= n) return parts.join("/");
  return parts.slice(parts.length - n).join("/");
}

/** 中段省略时附在中间的标记。 */
export const ELLIPSIS_MIDDLE = "…";

/**
 * 超长时**省略中段**（保头 + 保尾）。
 *
 * 与 `~/lib/text-clamp` 的 `clampText` 的分工：那个只保一头、方向是 `"head"` /
 * `"tail"`，服务**诊断文本**（报错原因在前 / 日志最新在后）；本函数保**两头**，
 * 服务**有结构的短标识**（路径、URL、id）—— 这类字符串的头（盘符 / scheme）
 * 与尾（文件名 / 资源名）都有信息量，中间那截没有。
 *
 * 返回值的长度**不超过 `maxLength`**（标记占掉自己的额度），与 `clampText` 同口径；
 * `maxLength` 小于标记长度时不留标记（只切到上限），避免「标完反而更长」。
 *
 * ```ts
 * // 一条超长的真实路径，上限给 40 个字符
 * ellipsisMiddle(p, 40); // 传一条超过 40 字符的路径
 * // 结果保头保尾、中段换成省略号，末尾的文件名仍在
 * ```
 */
export function ellipsisMiddle(
  text: string | null | undefined,
  maxLength: number,
): string {
  if (maxLength <= 0) return "";
  const s = text ?? "";
  if (s.length <= maxLength) return s;
  const mark = ELLIPSIS_MIDDLE;
  if (mark.length >= maxLength) return s.slice(0, maxLength);
  const budget = maxLength - mark.length;
  /* 头部**多留一格**（`ceil`）—— 路径的头是盘符 / `src/` 这类短前缀，
   * 尾部是文件名（通常更长），把奇数余额给头部能让两边都不至于只剩一个字符。 */
  const head = Math.ceil(budget / 2);
  const tail = budget - head;
  return s.slice(0, head) + mark + (tail > 0 ? s.slice(s.length - tail) : "");
}

/**
 * 分隔符归一：反斜杠 → 正斜杠。
 *
 * 单独导出是因为它不是「展示」独有的一步 —— `pathKey` 那类**比较键**也要它
 *（Windows 的 `\` 与 POSIX 的 `/` 在同一个字符串比较里必须同一形态）。
 * 但请注意：比较键还要 `.toLowerCase()`，那不是本函数的账（大小写在展示上要保留）。
 */
export function normalizeSlashes(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(/\\/g, "/").replace(/^\.\//, "");
}
