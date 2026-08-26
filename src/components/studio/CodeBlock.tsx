"use client";

/**
 * CodeBlock — shiki（VSCode 同款语法高亮引擎）驱动的源码展示块。
 *
 * 按需懒加载：首次打开时动态 import shiki 的 web bundle，之后缓存单例
 * highlighter，避免重复初始化。高亮输出为行内样式 HTML（不依赖外部 CSS
 * 主题），与弹窗暗色背景融合。
 */

import { useEffect, useState } from "react";

const EXT_TO_LANG: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "jsx",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".css": "css",
  ".scss": "scss",
  ".json": "json",
  ".md": "markdown",
  ".mdx": "markdown",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".html": "html",
  ".txt": "plaintext",
};

export function extToLanguage(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  if (dot < 0) return "plaintext";
  return EXT_TO_LANG[filePath.slice(dot).toLowerCase()] ?? "plaintext";
}

type ShikiHighlighter = {
  codeToHtml: (
    code: string,
    options: { lang: string; theme: string; transformers?: unknown[] }
  ) => string;
};

let highlighterPromise: Promise<ShikiHighlighter> | null = null;

function getHighlighter(): Promise<ShikiHighlighter> {
  highlighterPromise ??= (async () => {
    const shiki = (await import("shiki/dist/bundle-web.mjs")) as {
      createHighlighter: (options: {
        themes: string[];
        langs: string[];
      }) => Promise<ShikiHighlighter>;
    };
    return shiki.createHighlighter({
      themes: ["one-dark-pro"],
      langs: [
        "typescript",
        "tsx",
        "javascript",
        "jsx",
        "css",
        "scss",
        "json",
        "markdown",
        "yaml",
        "html",
        "plaintext",
      ],
    });
  })();
  return highlighterPromise;
}

/** 覆盖 shiki 输出 pre 的默认样式，与弹窗布局对齐 */
const PRE_STYLE =
  "margin:0;padding:12px 16px;font-size:11.5px;line-height:1.65;overflow:auto;background-color:transparent !important;";

/** 行号列的统一样式：注入到 CodeBlock 渲染容器，仅作用于本组件生成的
 *  shiki HTML（.shiki .line 结构），不影响全局。 */
const LINE_NUM_STYLE = `
.shiki .line { display: inline-flex; align-items: flex-start; width: 100%; }
.shiki .cb-ln {
  flex: none; width: 34px; margin-right: 14px; text-align: right;
  color: rgba(171,178,191,0.35); font-variant-numeric: tabular-nums;
  user-select: none;
}
`;

/** 为 shiki 输出的每一行注入行号。shiki v4 的 codeToHtml 每行以
 *  `<span class="line">` 开头，行间以换行符分隔；在行首前插入带序号的
 *  `.cb-ln` 前缀，由上方 CSS 的 inline-flex 布局左对齐成行号列。 */
function addLineNumbers(html: string): string {
  let line = 0;
  return html.replace(/<span class="line">/g, () => {
    line += 1;
    return `<span class="line"><span class="cb-ln">${line}</span>`;
  });
}

export function CodeBlock({ code, language }: { code: string; language: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getHighlighter()
      .then((hl) => {
        if (cancelled) return;
        setError(null);
        setHtml(
          addLineNumbers(
            hl.codeToHtml(code, {
              lang: language,
              theme: "one-dark-pro",
              transformers: [
                {
                  pre(node: { properties: { style?: string } }) {
                    node.properties.style = PRE_STYLE;
                  },
                },
              ],
            })
          )
        );
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setHtml(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  if (error) {
    /* 高亮失败兜底：纯文本逐行渲染，同样带行号，保证弹窗体验一致。 */
    const lines = code.split("\n");
    return (
      <pre className="nodrag nopan select-text px-4 py-3 font-mono text-[11.5px] leading-[1.65] text-gray-300">
        {lines.map((line, index) => (
          <div key={index} className="flex items-start">
            <span className="w-8 flex-none select-none pr-4 text-right text-gray-600">
              {index + 1}
            </span>
            <span className="whitespace-pre">{line}</span>
          </div>
        ))}
      </pre>
    );
  }
  if (!html) {
    return (
      <div className="flex items-center gap-2 px-4 py-6 text-[12px] text-gray-400">
        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-400/40 border-t-amber-300" />
        正在加载语法高亮…
      </div>
    );
  }
  return (
    <>
      <style>{LINE_NUM_STYLE}</style>
      <div
        className="nodrag nopan select-text"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  );
}
