/**
 * `src/lib/markdown` 域的出口：markdown → 可插入 DOM 的 HTML。
 *
 * 域的划分理由见 `docs/standards/18-lib层规范.md` §18.14 —— 它是「一段用户文本
 * 变成 DOM 片段」这一件事，与 `comfyui`（ComfyUI 编排）无关，历史上因为第一个
 * 消费方是 ComfyUI 便签而落在了 `lib/comfyui/` 里。
 */
export { markdownToHtml, renderMarkdown } from "./render";
export { sanitizeHtml } from "./html";
