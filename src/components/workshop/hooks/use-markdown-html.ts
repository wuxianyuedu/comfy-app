"use client";

/**
 * `useMarkdownHtml` —— 「一段 markdown 文本 → 可插入 DOM 的 HTML」的**按需**渲染。
 *
 * 为什么要一个 hook、而不是在视图里直接 `markdownToHtml(text)`：
 * `~/lib/markdown` 的顶层依赖是 `marked` + `dompurify`（含 DOMPurify 的白名单
 * 配置），是全库最重的两个客户端依赖。静态 import 它会让**任何静态可达的组件**
 * 把它们带进自己的静态图 —— 工坊中间列此前就是这样把两者一路带进入口
 * `src/app/workspace/page.tsx` 的（实测链：
 * `workspace/page.tsx -> WorkshopPipeline -> WorkshopStageBody -> lib/markdown`）。
 *
 * 本 hook 把那一步变成 `import()`：模块只在**第一次拿到非空 markdown** 时才下载。
 * 首帧（还没渲染出来）返回空串 —— 渲染 markdown 的场景（剧本预览）本身就不是
 * 首屏关键内容，空一拍比首屏多下载几百 KB 划算。
 *
 * 拿到之前那个 stale 守卫是必要的（规范 16 §16.2.4.34）：`text` 在下载期间变了时，
 * 旧一轮的结果不许落地。
 *
 * 判据 `scripts/check-barrel-heavy-deps.cjs`（规范 §12.19）会拒绝「又静态 import
 * 回 `~/lib/markdown` 的组件」。
 */
import { useEffect, useState } from "react";

import { beginStaleRun } from "~/lib/stale-run";

/** @param text 要渲染的 markdown；空串 / 全空白时不加载渲染器，直接给空串。 */
export function useMarkdownHtml(text: string): string {
  /* 结果连同「它是由哪一段文本渲染出来的」一起存 —— 于是「当前该显示什么」
   * 是一次**渲染期**对比就能得出的纯派生值，不必在 effect 里同步 `setState`
   *（规范 08 §8.6：React 19 的 `react-hooks/set-state-in-effect` 认这个形状）。
   * 换 `text` 的那一次渲染会立刻回到空串（旧 HTML 属于旧文本，不许留在屏幕上），
   * 下载完成后由 effect 异步提交新的一份。 */
  const [rendered, setRendered] = useState<{ from: string; html: string }>({
    from: "",
    html: "",
  });

  useEffect(() => {
    if (!text.trim()) {
      return;
    }
    const guard = beginStaleRun();
    void (async () => {
      const { loadMarkdownRenderer } = await import("~/lib/markdown");
      const { markdownToHtml } = await loadMarkdownRenderer();
      /* 加载期间 `text` 可能已经变了（用户接着编辑剧本）—— 旧轮次的结果不落地。 */
      guard.commit(() => {
        setRendered({ from: text, html: markdownToHtml(text) });
      });
    })();
    return () => {
      guard.dispose();
    };
  }, [text]);

  /* 异步提交落在**别的** `text` 上时（守卫与浏览器调度都可能让这一刻晚一拍）
   * 一律给空串 —— 宁可空一帧，也不把上一份剧本的 HTML 挂到新文本下。 */
  return rendered.from === text ? rendered.html : "";
}
