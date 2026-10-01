/**
 * markdown → 安全 HTML 渲染器（便签正文 / 剧本预览 / 工坊剧本区共用）。
 *
 * 解析交给 `marked`（GFM 开箱：表格、任务列表、删除线、脚注式引用、嵌套列表、
 * 图片、对齐），消毒交给 `DOMPurify`（白名单见 `sanitize-config.ts`），本文件只
 * 负责**把这三步按正确顺序串起来**，并保持历史上那两个导出名不变。
 *
 * ## 为什么是这个顺序（每一步都挡在前一步的产物上）
 *
 * ```
 *   text ──marked──► HTML ──DOMPurify──► 安全 HTML ──applyElementStyles──► 成品
 * ```
 *
 * - **解析在前、消毒在后**：反过来的话，消毒器看到的是源码而不是 HTML，只能按字面
 *   比对标签名 —— 而「markdown 会把它解析成什么标签」正是攻击面所在。
 * - **样式在最后**：先注入样式再消毒，注入的 `style` 会被白名单（刻意禁掉
 *   用户内容的 `style`）一起剥掉。顺序反了不会有任何报错，只会让渲染出来的东西
 *   悄悄没有样式。
 *
 * ## 与旧自研渲染器的行为差异（迁移时逐条登记，不要当成回归）
 *
 * 旧实现是「先整串 HTML 转义、再拼回自己生成的标签」，因此有一批行为是**转义的
 * 副产品**，不是设计：`~~x~~` 不渲染删除线、`1. x` 不渲染有序列表、缩进的子列表
 * 直接丢失、对齐标记被吃掉。迁移后这些都按 GFM 正常渲染 —— 见 `render.test.ts`
 * 的「与迁移前的刻意差异」一组用例。
 *
 * 仍然成立的一条：**输出由调用方交给 `dangerouslySetInnerHTML`**，因此本模块的
 * 返回值是「可以插进 DOM 的 HTML」，不是「一定安全」的担保 —— 担保在 `html.ts`
 * 的消毒那一步，而这里保证那段 HTML 一定过它。
 */
import { marked } from "marked";

import { sanitizeHtml } from "./html";
import { applyElementStyles } from "./styles";

/**
 * marked 的解析选项。
 *
 * - `gfm: true` / `breaks: false`：GFM 表格与任务列表要开，但**不**把单个换行当
 *   `<br>` —— 便签正文常常按显示宽度硬折行，`breaks: true` 会把每个折行都渲染成
 *   断行，反而把一段话拆散（旧实现把连续行合成一个 `<p>`，口径一致）。
 * - `pedantic: false` / `silent: false`：保持默认（按 GFM 而非原版 markdown.pl 解析）。
 * - `async: false`：同步返回。本模块在 React 渲染期被调用（`useMemo`），
 *   异步解析会把「渲染」变成一次状态机。
 */
const MARKED_OPTIONS = {
  gfm: true,
  breaks: false,
  async: false,
} as const;

/** 把一段 markdown 文本渲染成已消毒、已套样式的 HTML 片段。 */
export function markdownToHtml(text: string): string {
  if (!text) return "";
  const parsed = marked.parse(text, MARKED_OPTIONS);
  /* `async: false` 已经锁定同步返回，因此这里拿到的一定是字符串；
   *  断言失败（marked 改了返回类型契约）时宁可炸在渲染期，也不要静默插入
   *  一个 `[object Promise]`。 */
  if (typeof parsed !== "string") {
    throw new TypeError(
      "markdown/render：marked 返回了非字符串（async 选项被改动？）",
    );
  }
  return applyElementStyles(sanitizeHtml(parsed));
}

/** 给调用方的一个顺手助手：渲染成可直接用于 `dangerouslySetInnerHTML` 的串。 */
export function renderMarkdown(text: string): string {
  return markdownToHtml(text);
}
