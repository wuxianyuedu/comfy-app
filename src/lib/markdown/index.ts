/**
 * `src/lib/markdown` 域的出口：markdown → 可插入 DOM 的 HTML。
 *
 * 域的划分理由见 `docs/standards/18-lib层规范.md` §18.12 —— 它是「一段用户文本
 * 变成 DOM 片段」这一件事，与 `comfyui`（ComfyUI 编排）无关，历史上因为第一个
 * 消费方是 ComfyUI 便签而落在了 `lib/comfyui/` 里。
 */
export { markdownToHtml, renderMarkdown } from "./render";
export { sanitizeHtml } from "./html";

/** 按需取「markdown → 安全 HTML」的渲染器（规范 §12.19）。
 *
 * 为什么要这一个出口：`marked` + `dompurify`（连同 DOMPurify 那份白名单配置）是
 * 全库最重的两个客户端依赖之一，而它们的**唯一用途**是「真的有一段 markdown 要
 * 显示」。静态 import 本域会让所有**静态可达**的组件把它们拖进自己的静态图 ——
 * 工坊中间列（`WorkshopStageBody`）正是这样把两者带进入口的（实测链：
 * `workspace/page.tsx -> WorkshopPipeline -> WorkshopStageBody -> lib/markdown`）。
 *
 * 这个函数把那条边变成 `import()`：模块只在第一次真的渲染 markdown 时才下载，
 * 首屏不再为它付出代价。用法见 `~/components/workshop/WorkshopStageBody`。
 *
 * ⚠️ 静态 import 本模块**仍会**把 marked / dompurify 拉进静态图（它们是
 * `render.ts` / `html.ts` 的顶层依赖）。判据 `scripts/check-barrel-heavy-deps.cjs`
 * 会沿着静态边找到这里，所以「加了这个函数但还是静态 import」不算修好。 */
export async function loadMarkdownRenderer() {
  const mod = await import("./render");
  return {
    markdownToHtml: mod.markdownToHtml,
    renderMarkdown: mod.renderMarkdown,
  };
}
