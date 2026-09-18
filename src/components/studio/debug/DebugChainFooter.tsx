"use client";

/**
 * DebugChainFooter — 通用「渲染链路模块标签」组件。
 *
 * 订阅全局 debug-store；仅在调试模式开启时渲染。
 * 每个标签对应一个本项目代码模块：
 *  - 点击：弹出源码查看弹窗（GET /api/debug/source?file=... 读取该模块源码）
 *  - 弹窗内可复制完整相对路径 / 复制源码
 *  - hover title：显示完整相对路径
 *  - 防拖拽：阻断 pointer/mouse 事件冒泡，避免触发 ReactFlow 节点拖动
 *
 * 用法：
 *   <DebugChainFooter modules={getWorkflowRenderChainModules(classType)} />
 */

import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { CodeBlock, extToLanguage } from "../ui/CodeBlock";
import { fetchDebugSource } from "~/lib/workflow/debug-source-client";
import { useDebugStore } from "./debug-store";
import { overlayClass } from "~/lib/full-screen-layer";

export interface RenderChainModule {
  /** 完整相对路径（相对项目根，如 src/components/xxx.tsx） */
  file: string;
  /** 标签短名（卡片上显示） */
  label: string;
  /** 分组：canvas=画布级（画布容器/编排/状态层），node=节点级（节点渲染组件/工具）。默认 node。 */
  scope?: "canvas" | "node";
}

const PILL_STYLE: CSSProperties = {
  cursor: "pointer",
  userSelect: "none",
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  lineHeight: 1,
  padding: "2px 6px",
  borderRadius: 999,
  /* 琥珀状态色两态可读：浅色下深琥珀字 + 浅琥珀底，深色下保持原亮琥珀。 */
  border: "1px solid rgba(251,191,36,0.45)",
  background: "rgba(251,191,36,0.12)",
  color: "var(--color-warning)",
  whiteSpace: "nowrap",
};

interface SourcePayload {
  file: string;
  /** 绝对路径（正斜杠盘符格式），供 vscode://file/ 协议打开 */
  absolutePath: string;
  content: string;
  size: number;
  modifiedAt: string;
}

export function DebugChainFooter({
  modules,
}: {
  modules: RenderChainModule[];
}) {
  const debugMode = useDebugStore((state) => state.debugMode);

  const [openFile, setOpenFile] = useState<string | null>(null);
  const [source, setSource] = useState<SourcePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  /* 关闭弹窗：Esc 或点击遮罩 / 关闭按钮。 */
  const closeModal = useCallback(() => {
    setOpenFile(null);
    setSource(null);
    setLoadError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!openFile) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openFile, closeModal]);

  const openSource = useCallback(async (file: string) => {
    setOpenFile(file);
    setSource(null);
    setLoadError(null);
    setLoading(true);
    try {
      const payload = await fetchDebugSource(file);
      setSource(payload);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "读取源码失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const copyText = useCallback((text: string) => {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  }, []);

  /* 通过 vscode://file/<absolutePath> 协议在 VSCode 中打开源码文件。
   * 用隐藏 <a> 触发自定义协议，比 window.open 更稳（不被弹窗拦截）。 */
  const openInVscode = useCallback((absolutePath: string) => {
    const uri = `vscode://file/${absolutePath}`;
    const a = document.createElement("a");
    a.href = uri;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, []);

  const pillClick = (e: MouseEvent, module: RenderChainModule) => {
    e.stopPropagation();
    e.preventDefault();
    void openSource(module.file);
  };

  if (!debugMode || modules.length === 0) return null;

  /* 按 画布级/节点级 分组展示（scope 缺省视为 node） */
  const canvasModules = modules.filter((m) => (m.scope ?? "node") === "canvas");
  const nodeModules = modules.filter((m) => (m.scope ?? "node") === "node");

  const renderGroup = (title: string, group: RenderChainModule[]) => {
    if (group.length === 0) return null;
    return (
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 3,
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontSize: 8.5,
            lineHeight: 1,
            padding: "2px 5px",
            borderRadius: 4,
            background: "var(--color-border-subtle)",
            color: "var(--color-ink-fainter)",
            fontFamily: "var(--font-mono)",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </span>
        {group.map((module) => (
          <span
            key={module.file}
            title={`${module.file}（点击查看源码）`}
            onClick={(event) => pillClick(event, module)}
            style={PILL_STYLE}
          >
            {module.label}
          </span>
        ))}
      </div>
    );
  };

  return (
    <>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 3,
          padding: "4px 8px 6px",
          borderTop: "1px solid var(--color-border-subtle)",
          background: "var(--color-canvas-deep)",
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onDragStart={(event) => event.preventDefault()}
      >
        {renderGroup("画布级", canvasModules)}
        {renderGroup("节点级", nodeModules)}
      </div>

      {openFile &&
        createPortal(
          <div
            className={overlayClass(
              "modal",
              "z-100 flex items-center justify-center",
            )}
            role="presentation"
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {/* 遮罩：点击关闭 */}
            <button
              type="button"
              aria-label="关闭源码查看"
              onClick={closeModal}
              className="absolute inset-0 cursor-default bg-black/25 backdrop-blur-[2px] dark:bg-black/60"
            />
            {/* 弹窗主体 */}
            <div
              role="dialog"
              aria-label="源码查看"
              className="border-border-strong bg-panel relative flex max-h-[78vh] w-[min(860px,92vw)] flex-col overflow-hidden rounded-2xl border shadow-2xl"
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              {/* 头部：路径 + 操作按钮 */}
              <div className="border-border-strong flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className="text-[14px] text-amber-700 dark:text-amber-300/90"
                  >
                    ◈
                  </span>
                  <code
                    className="text-ink-bright truncate font-mono text-[12px]"
                    title={openFile}
                  >
                    {openFile}
                  </code>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => source && openInVscode(source.absolutePath)}
                    disabled={!source}
                    className="rounded-md border border-sky-400/30 bg-sky-400/10 px-2.5 py-1 text-[11px] font-medium text-sky-700 transition-colors hover:bg-sky-400/20 disabled:opacity-40 dark:text-sky-200"
                    title="在 Visual Studio Code 中打开该文件（需已安装 VSCode）"
                  >
                    在 VSCode 打开
                  </button>
                  <button
                    type="button"
                    onClick={() => copyText(openFile)}
                    className="border-border-strong bg-subtle text-ink-soft hover:bg-surface-2 hover:text-ink-bright rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors"
                    title="复制完整相对路径"
                  >
                    复制路径
                  </button>
                  <button
                    type="button"
                    onClick={() => source && copyText(source.content)}
                    disabled={!source}
                    className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[11px] font-medium text-amber-700 transition-colors hover:bg-amber-400/20 disabled:opacity-40 dark:text-amber-200"
                    title="复制全部源码"
                  >
                    复制代码
                  </button>
                  <button
                    type="button"
                    onClick={closeModal}
                    aria-label="关闭"
                    className="border-border-strong bg-subtle text-ink-soft hover:bg-surface-2 hover:text-ink-bright rounded-md border px-2 py-1 text-[11px] transition-colors"
                  >
                    ✕
                  </button>
                </div>
              </div>
              {/* 内容区 */}
              <div className="bg-canvas-deep min-h-0 flex-1 overflow-auto p-0">
                {loading && (
                  <div className="text-ink-soft flex items-center justify-center gap-2 py-10 text-[12px]">
                    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-400/40 border-t-amber-300" />
                    正在读取源码…
                  </div>
                )}
                {!loading && loadError && (
                  <div className="px-4 py-6 text-[12px] text-rose-700 dark:text-rose-300">
                    读取失败：{loadError}
                  </div>
                )}
                {!loading && source && (
                  <div className="flex flex-col">
                    <div className="border-border-subtle bg-subtle text-ink-muted flex shrink-0 items-center justify-between border-b px-4 py-1.5 font-mono text-[10.5px]">
                      <span>{source.size.toLocaleString()} 字符</span>
                      <span>{source.modifiedAt}</span>
                    </div>
                    {/* key=openFile：切换查看的文件时强制重挂载 CodeBlock，
                        避免复用旧实例的 html/error 状态闪现上一份源码。 */}
                    <CodeBlock
                      key={openFile}
                      code={source.content}
                      language={extToLanguage(openFile)}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
