"use client";

/**
 * JsonViewer — 重构
 *
 * 之前 自写的纯客户端 JSON 查看器 (660+ 行) 已有结构性问题：
 *   - PrimitiveRow 用 `<div>` 渲染值，block-in-block 把 key-value 拆两行
 *   - 嵌套 paddingLeft 在深 indent 处把值挤到右侧 → 视觉错位
 *   - primitive string 整段渲染，没有 substring 着色 → active hit 看不出来
 *
 * 改用 react18-json-view 处理渲染层 (语法着色 / 容器折叠 / 长 string
 * 折叠 / 暗黑主题 / clipboard / 多主题 + URL 识别)。我们只负责：
 *   1. 搜索 (collectHits 遍历 + 计数 + Enter/Shift+Enter/箭头/Esc)
 *   2. scroll-into-view (active hit 居中)
 *   3. DOM 后处理 (text node 内 substring 高亮 + active hit 行标 + data-jv-active-hit)
 *
 * 选 react18-json-view 的理由:
 *   - 0.2.10, 4 月前发布, 仍维护, React 18+ 兼容声明
 *   - 零业务依赖 + 7 主题 + CSS 变量覆盖
 *   - 我们自己的搜索/计数/跳转逻辑还是自写 (50 行 wrapper),
 *     但渲染结构、外观、长 string 折叠、clipboard 全交给 lib。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import JsonView from "react18-json-view";
import "react18-json-view/src/style.css";
import { Icon } from "@/components/ui/icon";

// ─── 路径工具 ──────────────────────────────────────────────────────────────
type JsonValue =
  null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

/** 命中路径 — `{[nodeId]: {class_type, inputs, widgets_values, ...}}` 这一层
 *  对应 `["nodes", "3", "widgets_values", "2"]`。在 我们用不到具体 path
 *  做 DOM 后处理, 留作 collectHits 返回类型 + 日后扩展 (例如 toggle 行级
 *  highlight) 时使用。 */
type Path = readonly (string | number)[];

// ─── 命中收集 ──────────────────────────────────────────────────────────────
/** 收集所有命中路径 (key / primitive value 都参与匹配, 大小写不敏感) */
function collectHits(root: JsonValue, query: string): Path[] {
  const q = query.toLowerCase();
  if (!q) return [];
  const hits: Path[] = [];

  const visit = (node: JsonValue, path: Path) => {
    if (node === null) {
      if ("null".includes(q)) hits.push(path);
      return;
    }
    if (typeof node === "string") {
      if (node.toLowerCase().includes(q)) hits.push(path);
      return;
    }
    if (typeof node === "number") {
      if (String(node).toLowerCase().includes(q)) hits.push(path);
      return;
    }
    if (typeof node === "boolean") {
      if (String(node).toLowerCase().includes(q)) hits.push(path);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((value, index) => visit(value, [...path, index]));
      return;
    }
    // object
    for (const k of Object.keys(node)) {
      if (k.toLowerCase().includes(q)) hits.push([...path, k]);
      visit(node[k]!, [...path, k]);
    }
  };

  visit(root, []);
  return hits;
}

// ─── DOM 后处理 (active hit 高亮 + substring 着色) ────────────────────────

/** 高亮 CSS 注入 (一次性 module-load) — 用 CSS 比 inline style 更稳 */
let HIGHLIGHT_CSS_INJECTED = false;
function ensureHighlightCss() {
  if (HIGHLIGHT_CSS_INJECTED || typeof document === "undefined") return;
  const style = document.createElement("style");
  style.dataset.jvHilite = "true";
  style.textContent = `
/* 非 active hit — 行级提示色 */
.json-view .json-view--pair[data-jv-hit="true"] {
  background-color: rgba(251, 191, 36, 0.10);
  border-radius: 3px;
  box-shadow: inset 0 0 0 1px rgba(251, 191, 36, 0.30);
}
/* active hit — 强对比 */
.json-view .json-view--pair[data-jv-active-hit="true"] {
  background-color: rgba(251, 191, 36, 0.32) !important;
  border-radius: 3px;
  box-shadow: inset 0 0 0 2px rgb(251, 191, 36) !important;
}
/* string value 内的 substring mark */
.json-view mark.jv-hit-sub {
  background-color: rgba(251, 191, 36, 0.32);
  /* 命中子串文字色跟主题：写死 rgb(254,243,199)（近白）时，Light 下是
     近白字压浅琥珀底，看不到。浅色用深琥珀，深色保留原近白。 */
  color: var(--json-view-hit-sub-ink, rgb(120, 53, 15));
  border-radius: 2px;
  padding: 0 1px;
}
.dark .json-view mark.jv-hit-sub {
  --json-view-hit-sub-ink: rgb(254, 243, 199);
}
.json-view mark.jv-hit-sub[data-jv-active-hit="true"] {
  background-color: rgb(251, 191, 36);
  color: rgb(24, 16, 28);
  box-shadow: 0 0 0 2px rgb(251, 191, 36);
  font-weight: 600;
}
`;
  document.head.appendChild(style);
  HIGHLIGHT_CSS_INJECTED = true;
}

/** 删除掉之前注入的命中标记 — 重新扫描前先清干净 */
function clearPreviousHighlights(body: HTMLElement) {
  // 1. 移除 active hit / passive hit 的行级 data 标记
  body.querySelectorAll(".json-view--pair[data-jv-hit]").forEach((el) => {
    el.removeAttribute("data-jv-hit");
    el.removeAttribute("data-jv-active-hit");
  });
  // 2. 把注入的 <mark class="jv-hit-sub"> 还原成 textNode
  body.querySelectorAll("mark.jv-hit-sub").forEach((mark) => {
    const txt = document.createTextNode(mark.textContent || "");
    mark.parentNode?.replaceChild(txt, mark);
  });
  // 3. 合并相邻 textNode
  body.normalize();
}

/** 把 hits 注入 DOM (行级 + substring) */
function applyHighlights(
  body: HTMLElement,
  hits: Path[],
  hitIndex: number,
  query: string,
) {
  clearPreviousHighlights(body);
  if (!query || hits.length === 0) return;

  const q = query.toLowerCase();
  // 提前统计每个 primitive text-node 的命中数, 用于将全局 activeIdx 映射到
  // 当前活跃的那个 <mark>. 这要在 fragment 替换之前先知道数量.
  // 我们用一次"dry walk" 收集所有 lenArray (per textnode) 然后再 walk 替换.

  // ── 收集所有叶子 textNode 的命中数 (顺序 = 命中顺序) ──
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const cls = parent.className;
      if (typeof cls !== "string") return NodeFilter.FILTER_REJECT;
      if (
        cls.includes("json-view--string") ||
        cls.includes("json-view--number") ||
        cls.includes("json-view--boolean") ||
        cls.includes("json-view--null") ||
        cls.includes("json-view--property")
      ) {
        return NodeFilter.FILTER_ACCEPT;
      }
      return NodeFilter.FILTER_REJECT;
    },
  });

  type HitNode = { node: Text; count: number };
  const targets: HitNode[] = [];
  let cur = walker.nextNode();
  while (cur) {
    const t = cur as Text;
    const text = t.textContent || "";
    if (text.toLowerCase().includes(q)) {
      // 估算该 textNode 内出现次数 (大小写不敏感)
      const lower = text.toLowerCase();
      let count = 0;
      let p = 0;
      while (true) {
        const j = lower.indexOf(q, p);
        if (j < 0) break;
        count += 1;
        p = j + q.length;
      }
      if (count > 0) targets.push({ node: t, count });
    }
    cur = walker.nextNode();
  }

  // ── 把 hitIndex 映射回"textnode + 该 node 内第几个" ──
  // 假设 leaf textNodes 的命中数合计 <= hits.length (后者含 key 命中, 前者只看 primitive 节点).
  // 如果对不上, 我们只能尽力 fallback — 高亮能标多少算多少.
  const totalLeafHits = targets.reduce((sum, target) => sum + target.count, 0);
  let activeCursor = hitIndex;
  let activeNode: Text | null = null;
  if (activeCursor < totalLeafHits) {
    for (const t of targets) {
      if (activeCursor < t.count) {
        activeNode = t.node;
        break;
      }
      activeCursor -= t.count;
    }
  }

  // ── 替换: 每个 textnode 拆成 Text/Text/<mark>/.../Text ──
  let globalIdx = 0;
  for (const t of targets) {
    const orig = t.node.textContent || "";
    const lower = orig.toLowerCase();
    const frag = document.createDocumentFragment();
    let i = 0;
    while (i < orig.length) {
      const j = lower.indexOf(q, i);
      if (j < 0) {
        frag.appendChild(document.createTextNode(orig.slice(i)));
        break;
      }
      if (j > i) frag.appendChild(document.createTextNode(orig.slice(i, j)));
      const isActive = activeNode === t.node && globalIdx === hitIndex;
      const mark = document.createElement("mark");
      mark.className = "jv-hit-sub";
      if (isActive) mark.dataset.jvActiveHit = "true";
      mark.textContent = orig.slice(j, j + q.length);
      frag.appendChild(mark);
      globalIdx += 1;
      i = j + q.length;
    }
    t.node.parentNode?.replaceChild(frag, t.node);
  }
}

// ─── 外层组件 ──────────────────────────────────────────────────────────────
export interface JsonViewerProps {
  data: unknown;
  /** Toolbar 副标题 (默认 "JSON") */
  title?: string;
  /** 默认折叠深度 (重新定义):
   *   - 0   → 全部展开 (top-level objects 内嵌子项也展开)
   *   - >=1 → 超 N 项的 object/array 在首次渲染时折叠 (N=20+depth*40, dense 场景下更紧凑)
   * 默认 1 (与之前的语义接近) */
  initialCollapsedDepth?: number;
}

export function JsonViewer({
  data,
  title = "JSON",
  initialCollapsedDepth = 1,
}: JsonViewerProps) {
  // ── 搜索 + 命中索引 ──
  const [query, setQuery] = useState("");
  const [hitIndex, setHitIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  // 树容器 ref (供 highlight + scroll 使用)
  const bodyRef = useRef<HTMLDivElement>(null);

  const hits = useMemo(
    () => collectHits(data as JsonValue, query.trim()),
    [data, query],
  );

  // 数据 / query 变化: 重置 hitIndex（render 阶段同步，避免 effect 级联渲染）
  const [prevQuery, setPrevQuery] = useState(query);
  if (prevQuery !== query) {
    setPrevQuery(query);
    setHitIndex(0);
  }

  // ── DOM 后处理: query / hitIndex / data 变化时重新注入高亮 ──
  useEffect(() => {
    ensureHighlightCss();
    if (!bodyRef.current) return;
    // 折叠 state 引发的 DOM 变化先 settle, 再扫
    requestAnimationFrame(() => {
      if (!bodyRef.current) return;
      applyHighlights(bodyRef.current, hits, hitIndex, query.trim());
    });
  }, [query, hits, hitIndex, data]);

  // ── active hit 居中滚动 ──
  useEffect(() => {
    if (!bodyRef.current || hits.length === 0) return;
    const raf = requestAnimationFrame(() => {
      const el = bodyRef.current?.querySelector(
        "mark.jv-hit-sub[data-jv-active-hit]",
      ) as HTMLElement | null;
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(raf);
  }, [hitIndex, hits]);

  // ── ⌘/Ctrl+F 快捷键 ──
  const focusSearch = useCallback(() => {
    searchRef.current?.focus();
    searchRef.current?.select();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        focusSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusSearch]);

  const nextHit = useCallback(
    (dir: 1 | -1) => {
      if (hits.length === 0) return;
      setHitIndex((index) => (index + dir + hits.length) % hits.length);
    },
    [hits.length],
  );

  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      nextHit(e.shiftKey ? -1 : 1);
    }
    if (e.key === "Escape") {
      setQuery("");
      (e.target as HTMLInputElement).blur();
    }
  };

  // ── 拷贝 ──
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  // ── 渲染 ──
  // collapseObjectsAfterLength: initialCollapsedDepth=0 → 不折叠, 否则按深度折叠
  const collapseThreshold =
    initialCollapsedDepth >= 1 ? 30 + initialCollapsedDepth * 40 : 1e9;

  return (
    <div className="bg-panel-deep flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="border-border bg-panel flex items-center gap-2 border-b px-3 py-1.5 text-xs">
        <span className="text-ink-bright font-medium">{title}</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={copy}
          className="border-border text-ink-muted hover:bg-subtle hover:text-ink-bright rounded border px-2 py-0.5"
          title="把当前 JSON 复制到剪贴板"
        >
          {copied ? "已复制" : "复制"}
        </button>
      </div>

      {/* 搜索条 */}
      <div className="border-border-subtle flex items-center gap-2 border-b px-3 py-1.5 text-xs">
        <Icon name="search" size={14} className="text-ink-fainter shrink-0" />
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onSearchKey}
          placeholder="搜索 key / string / number / bool / null…（⌘F / Ctrl+F）"
          className="border-border bg-canvas-deep text-ink-bright placeholder:text-ink-faintest flex-1 rounded border px-2 py-0.5 font-mono outline-none focus:border-violet-400/60"
        />
        {query && (
          <span className="text-ink-muted font-mono">
            {hits.length === 0 ? "0 / 0" : `${hitIndex + 1} / ${hits.length}`}
          </span>
        )}
        {query && (
          <>
            <button
              type="button"
              onClick={() => nextHit(-1)}
              disabled={hits.length === 0}
              className="border-border text-ink-muted hover:bg-subtle rounded border px-2 py-0.5 disabled:opacity-30"
              title="上一个 (Shift+Enter)"
            >
              <Icon name="chevronup" size={14} className="text-ink-muted" />
            </button>
            <button
              type="button"
              onClick={() => nextHit(1)}
              disabled={hits.length === 0}
              className="border-border text-ink-muted hover:bg-subtle rounded border px-2 py-0.5 disabled:opacity-30"
              title="下一个 (Enter)"
            >
              <Icon name="chevrondown" size={14} className="text-ink-muted" />
            </button>
            <button
              type="button"
              onClick={() => setQuery("")}
              className="border-border text-ink-muted hover:bg-subtle rounded border px-2 py-0.5"
              title="清空 (Esc)"
            >
              <Icon name="close" size={14} className="text-ink-muted" />
            </button>
          </>
        )}
      </div>

      {/* 主体 (lib 渲染) */}
      <div
        ref={bodyRef}
        className="min-h-0 flex-1 overflow-auto px-3 py-2"
        data-testid="json-viewer-body"
      >
        {data === undefined ? (
          <span className="text-ink-fainter">(empty)</span>
        ) : (
          <JsonView
            src={data}
            /* 不再传 `dark`（它会挂上写死的 dark.css），语法着色统一由
               `.jv-theme-comfy` 的两态 token 负责（见 globals.css）。 */
            theme="default"
            // collapsed={false} 让初始全部展开, dense 场景靠 collapseObjectsAfterLength 自然折叠
            collapsed={false}
            collapseObjectsAfterLength={collapseThreshold}
            collapseStringsAfterLength={80}
            collapseStringMode="word"
            enableClipboard={false}
            displaySize={false}
            displayArrayIndex
            matchesURL={false}
            className="jv-theme-comfy"
          />
        )}
      </div>
    </div>
  );
}

/* 本组件的语法着色不再内联注入：`.jv-theme-comfy` 的两态 token 定义在
   globals.css（浅色默认 + `.dark` 覆盖），避免组件里再养一份与主题脱钩的副本。 */
