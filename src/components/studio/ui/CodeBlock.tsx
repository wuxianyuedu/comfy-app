"use client";

/**
 * CodeBlock — shiki（VSCode 同款语法高亮引擎）驱动的源码展示块。
 *
 * 实现要点（2026-08-26 重构，修复「行号不显示」+「大文件高亮卡死 UI」）：
 *  1. 行号可靠性：不再对 shiki 的 HTML 字符串做正则注入，改用
 *     codeToTokensBase 拿结构化 token 后由 React 直接渲染，每行固定
 *     「行号列 + 代码列」两段 span，样式由本组件自己的 CSS 类控制，
 *     不依赖 shiki 输出的 DOM 结构，行号 100% 可见。
 *  2. 不阻塞主线程：按 CHUNK_LINES 行分片高亮，片间 setTimeout 让出
 *     主线程；首帧先渲染纯文本行号，高亮完成后再整体替换。打开
 *     38KB 级源码文件时 UI 始终保持响应，不再出现「点不动」。
 *  3. 超大文件阈值：超过 MAX_HIGHLIGHT_CHARS 直接走纯文本行号渲染，
 *     避免 shiki 高亮数万字符白耗主线程。
 *
 * 按需懒加载：首次打开时动态 import shiki 的 web bundle，之后缓存单例
 * highlighter，避免重复初始化。
 */

import { useEffect, useState, type CSSProperties } from "react";

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

/** shiki v4 codeToTokensBase 返回的单行 token（Token[][] 的成员） */
interface ShikiToken {
  content: string;
  offset?: number;
  color?: string;
  fontStyle?: number;
}

type ShikiHighlighter = {
  codeToTokensBase: (
    code: string,
    options: { lang: string; theme: string }
  ) => ShikiToken[][];
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

/** 超大文件阈值：超过则不做语法高亮，直接纯文本行号渲染
 *  （shiki 高亮耗时与文本量成正比，超大文件高亮性价比低且易卡 UI） */
const MAX_HIGHLIGHT_CHARS = 120_000;

/** 分片行数：每片高亮完让出主线程（setTimeout 0），保持 UI 响应 */
const CHUNK_LINES = 400;

/** 组件私有 CSS：行号列 + 代码列 flex 布局。只作用于本组件渲染的元素，
 *  不依赖 shiki 输出结构，行号必然生效。 */
const CODE_BLOCK_CSS = `
.cb-code-block { padding: 12px 16px; font-family: ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace; font-size: 11.5px; line-height: 1.65; overflow: auto; }
.cb-line { display: flex; align-items: flex-start; min-height: 1.65em; }
.cb-ln { flex: none; width: 40px; padding-right: 14px; text-align: right; color: rgba(171,178,191,0.35); font-variant-numeric: tabular-nums; user-select: none; }
.cb-code { white-space: pre; color: #abb2bf; }
`;

/** token 的 fontStyle 位掩码：1=italic，2=bold（shiki 约定） */
function tokenInlineStyle(tok: ShikiToken): CSSProperties {
  const style: CSSProperties = {};
  if (tok.color) style.color = tok.color;
  if (tok.fontStyle != null) {
    if ((tok.fontStyle & 1) !== 0) style.fontStyle = "italic";
    if ((tok.fontStyle & 2) !== 0) style.fontWeight = 600;
  }
  return style;
}

/** 纯文本行号渲染：首帧（高亮未就绪）/ 超大文件 / 高亮失败时的兜底，
 *  保证任何时刻弹窗都有行号。 */
function PlainCodeBlock({ code }: { code: string }) {
  const lines = code.split("\n");
  return (
    <div className="cb-code-block">
      {lines.map((line, index) => (
        <div key={`line-${index}`} className="cb-line">
          <span className="cb-ln">{index + 1}</span>
          <span className="cb-code">{line.length > 0 ? line : " "}</span>
        </div>
      ))}
    </div>
  );
}

export function CodeBlock({ code, language }: { code: string; language: string }) {
  const [tokens, setTokens] = useState<ShikiToken[][] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      /* 首帧提交纯文本行号，再异步进入高亮流程 */
      await Promise.resolve();
      if (cancelled) return;
      setTokens(null);
      setError(null);

      /* 超大文件：跳过 shiki，保持纯文本行号（不阻塞主线程） */
      if (code.length > MAX_HIGHLIGHT_CHARS) return;

      try {
        const hl = await getHighlighter();
        if (cancelled) return;
        const allLines = code.split("\n");
        const totalChunks = Math.ceil(allLines.length / CHUNK_LINES);
        const acc: ShikiToken[][] = [];
        let chunkIndex = 0;

        const processChunk = () => {
          if (cancelled) return;
          const start = chunkIndex * CHUNK_LINES;
          const slice = allLines.slice(start, start + CHUNK_LINES);
          const chunkTokens = hl.codeToTokensBase(slice.join("\n"), {
            lang: language,
            theme: "one-dark-pro",
          });
          acc.push(...chunkTokens);
          chunkIndex += 1;
          if (chunkIndex < totalChunks) {
            /* 让出主线程一帧，长文件高亮期间 UI 保持可点 */
            setTimeout(processChunk, 0);
          } else if (!cancelled) {
            setTokens(acc);
          }
        };

        setTimeout(processChunk, 0);
      } catch (err: unknown) {
        if (!cancelled) {
          setTokens(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  if (error) {
    return (
      <div className="cb-code-block">
        <div className="cb-line">
          <span className="cb-code text-[11px] text-rose-300">
            语法高亮失败：{error}
          </span>
        </div>
      </div>
    );
  }

  /* 首帧 / 超大文件：纯文本行号（立即可见、不阻塞） */
  if (tokens === null) {
    return <PlainCodeBlock code={code} />;
  }

  return (
    <>
      <style>{CODE_BLOCK_CSS}</style>
      <div className="cb-code-block">
        {tokens.map((line, lineIndex) => (
          <div key={lineIndex} className="cb-line">
            <span className="cb-ln">{lineIndex + 1}</span>
            <span className="cb-code">
              {line.length === 0
                ? " "
                : line.map((tok, tokenIndex) => (
                    <span key={tokenIndex} style={tokenInlineStyle(tok)}>
                      {tok.content}
                    </span>
                  ))}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
