/**
 * 消毒白名单：**用户内容里哪些标签、属性和 URL 协议可以活下来**。
 *
 * 这是本模块唯一的安全边界。它替掉的是一套自研的「先整串 HTML 转义、再按我认得
 * 的语法拼回标签」白名单 —— 那种口径每加一种语法就多一处需要重新论证「这次转义
 * 是否完整」的表面积。现在判定交给 DOMPurify（被反复审计、按浏览器解析器的真实
 * 行为做决定），本文件只回答「本仓库要的是哪一份口径」。
 *
 * 三条取舍，逐条有理由（不要把它们当默认值抄走）：
 *
 * 1. **基表用 `USE_PROFILES: { html: true }`，不用 DOMPurify 默认全表**。
 *    默认全表含 SVG / MathML / `<template>` —— 便签与剧本预览里没有一处需要它们，
 *    而它们恰是历史上绕过消毒的高发区。实测：`<svg><script>…` 在默认表下会剥掉
 *    脚本但保留 `<svg>` 外壳；换成 html profile 后整段为空。
 *
 * 2. **`FORBID_TAGS` 收掉表单类**。html profile 放行 `<form>` / `<button>`，而用户
 *    内容里出现表单只有一个用途：钓鱼（把便签画成登录框）。`<input>` **保留** ——
 *    GFM 任务列表（`- [x] 完成`）渲染出来就是它，是本仓库要的能力。
 *
 * 3. **`FORBID_ATTR` 收掉 `style`**。用户内容不许自带样式，理由不是「不好看」而是
 *    「挡不住」：`position:fixed` 能让一块内容盖住整个应用、`background:url(…)` 能在
 *    渲染时发起外部请求（whoami 外带）。本仓库自己要的那批样式由渲染**之后**的一步
 *    注入（`styles.ts`），两者不冲突。
 */

/** 用户内容里**禁止出现**的标签。 */
export const FORBIDDEN_TAGS: readonly string[] = [
  /* 表单：钓鱼面。`<input>` 不在其中（GFM 任务列表要用）。 */
  "form",
  "button",
  "select",
  "option",
  "optgroup",
  "textarea",
  "fieldset",
  "legend",
  "label",
  "datalist",
  "output",
  /* 外链嵌入元素：html profile 本就不放行，显式列出是为了让「为什么它不在」
   *  有一个可读的答案（与 §12.14 的收口思路同款）。 */
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
  "base",
];

/** 用户内容里**禁止出现**的属性。 */
export const FORBIDDEN_ATTRS: readonly string[] = [
  "style",
  "action",
  "formaction",
  "method",
  "ping",
  "srcdoc",
  "download",
  "srcset",
];

/**
 * 允许在 `href` / `src` 上出现的 **URL 协议**。
 *
 * **为什么 DOMPurify 的默认口径不够**：它拦的是「可执行 / 可脚本化」的 scheme
 * （`javascript:` / `vbscript:` / `blob:` / `file:` 实测都被剥），但**放行 `data:`**
 * —— 对 `href` 它会拦（`data:text/html,<script>…` 实测被剥成 `<a>x</a>`），对
 * `src` 它不拦。而 `src="data:image/svg+xml,…"` 在浏览器里解析出来的 SVG **可以带脚本**，
 * 于是「markdown 里的图片」变成一条执行通道。便签与剧本预览里没有一处需要 `data:`
 * 图片（上传走的是 `blob:` / 同源路径），因此这里按协议收口。
 *
 * 前缀匹配发生在 DOMPurify 剥掉控制字符与首尾空白**之后**（它的 `.data` 钩子挂在
 * 剪枝之后），因此 `java\tscript:` 这类绕过面不需要在这里再挡一次。
 */
export const ALLOWED_URL_SCHEMES: readonly string[] = [
  "http:",
  "https:",
  "mailto:",
  "tel:",
  /* 相对路径、绝对路径、锚点：没有 scheme，浏览器按当前 origin 解析。 */
  "",
  "/",
  "#",
  "?",
  ".",
];

/** 消毒配置：喂给 `DOMPurify.sanitize` 的第三个参数。 */
export interface SanitizeConfig {
  USE_PROFILES: { html: true };
  FORBID_TAGS: string[];
  FORBID_ATTR: string[];
}

/** 配置的**唯一出口**。调用方不要就地拼一份自己的。 */
export function createSanitizeConfig(): SanitizeConfig {
  return {
    USE_PROFILES: { html: true },
    /* 复制成可变数组：DOMPurify 会就地规整传入的清单，传共享的 `readonly` 数组
     *  会让第一次调用顺手改掉模块级常量。 */
    FORBID_TAGS: [...FORBIDDEN_TAGS],
    FORBID_ATTR: [...FORBIDDEN_ATTRS],
  };
}

/**
 * 这个 URL 值是否落在允许的协议白名单里。
 *
 * 判定前先按 DOMPurify 自己的口径归一（去首尾空白、去掉 `\t\n\r`）—— 浏览器解析
 * URL 时同样会先剥掉这些字符，不归一的话 `java\tscript:` 会在这里被读成「相对路径」。
 */
export function isAllowedUrl(value: string): boolean {
  const normalized = value
    .replace(/[\t\n\r]/g, "")
    .trimStart()
    .toLowerCase();
  const schemeEnd = normalized.indexOf(":");
  const scheme = schemeEnd === -1 ? "" : normalized.slice(0, schemeEnd + 1);
  /* scheme 里含 `/` 说明 `:` 出现在路径之中（`/a:b`），那仍是相对路径。 */
  if (scheme.includes("/")) return ALLOWED_URL_SCHEMES.includes("");
  return ALLOWED_URL_SCHEMES.includes(scheme);
}
