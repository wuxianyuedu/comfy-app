"use client";

/**
 * `useMarkdownHtml` —— markdown → HTML 的**按需**渲染。`~/lib/markdown` 顶层依赖 `marked` + `dompurify`（全库最重的两个客户端依赖），静态 import 会把它们带进
 * 任何静态可达组件的图，故这里改成 `import()`：第一次拿到非空 markdown 才下载，首帧返回空串。stale 守卫必要（规范 16 §16.2.4.34）：下载期间 `text` 变了时旧一轮
 * 结果不许落地。判据 `scripts/gates/check-barrel-heavy-deps.cjs` 拒绝静态 import 回它。
 * #4610：进解析的那条路再加 250ms 防抖 —— 此前逐键全量 parse（marked + DOMPurify
 * + 整块替换）是长剧本输入的主线程抖动源；编辑态文本本身不延迟，只降解析频率。
 */
import { useEffect, useState } from "react";

import { useDebouncedValue } from "~/components/ui/use-debounced-value";
import { beginStaleRun } from "~/lib/stale-run";

/** 预览解析的防抖窗口：连续敲键只解析最后一次（#4610 给的 200~300ms 取中值）。 */
export const PREVIEW_PARSE_DEBOUNCE_MS = 250;

/** @param text 要渲染的 markdown；空串 / 全空白时不加载渲染器，直接给空串。 */
export function useMarkdownHtml(text: string): string {
  /* 结果连同「它是由哪一段文本渲染出来的」一起存 —— 于是「当前该显示什么」
   * 是一次**渲染期**对比就能得出的纯派生值，不必在 effect 里同步 `setState`
   *（规范 08 §8.6：React 19 的 `react-hooks/set-state-in-effect` 认这个形状）。 */
  const [rendered, setRendered] = useState<{ from: string; html: string }>({
    from: "",
    html: "",
  });
  /* 防抖后的文本才是「进解析的那条路」：编辑本身零延迟，解析最多 250ms 一拍
   *（#4610）。 */
  const debouncedText = useDebouncedValue(text, PREVIEW_PARSE_DEBOUNCE_MS);

  useEffect(() => {
    if (!debouncedText.trim()) {
      return;
    }
    const guard = beginStaleRun();
    void (async () => {
      const { loadMarkdownRenderer } = await import("~/lib/markdown");
      const { markdownToHtml } = await loadMarkdownRenderer();
      /* 加载期间防抖值可能已经变了（用户接着编辑剧本）—— 旧轮次的结果不落地。 */
      guard.commit(() => {
        setRendered({ from: debouncedText, html: markdownToHtml(debouncedText) });
      });
    })().catch((error: unknown) => {
      /* #4238：分块加载失败不再静默——rejection 无人接只会进 LogProvider 的
       * unhandled 桶；这里留一条带现场的日志（进面板），预览保持纯文本，
       * 下次 text 变更自然重触发加载。 */
      console.error("[workshop] markdown 渲染器加载失败，剧本预览暂不可用", error);
    });
    return () => {
      guard.dispose();
    };
  }, [debouncedText]);

  /* 防抖窗口内 `text` 领先于已解析的 `debouncedText`：继续显示**上一份已解析**
   * 的 HTML —— 预览慢半拍是 markdown 编辑器的标准形态，好过每键闪空；
   * 解析落地后这里自然追平。空串输入闸（#4384）语义不变：debouncedText 归空
   * 后比对失配，返回空串。 */
  return rendered.from === debouncedText ? rendered.html : "";
}
