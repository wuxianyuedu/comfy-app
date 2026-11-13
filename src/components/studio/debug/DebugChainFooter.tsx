"use client";

/**
 * DebugChainFooter — 通用「渲染链路模块标签」组件，订阅全局 debug-store，仅调试模式渲染。
 * 每个标签对应一个本项目模块：点击弹源码查看（GET /api/debug/source?file=...），
 * 弹窗可复制路径/源码，hover title 显示完整相对路径；阻断 pointer/mouse 冒泡以免触发节点拖动。
 * `modules` 传 getWorkflowRenderChainModules(classType) 的结果。 */

import { useCallback, useState, type CSSProperties } from "react";
import { CodeBlock, extToLanguage } from "~/components/ui/code-block";
import { Hint } from "~/components/ui/hint";
import { copyFailureText, useCopyFeedback } from "~/components/ui/use-copy-feedback";
import { useFlashState } from "~/components/ui/use-flash-state";
import { fetchDebugSource } from "~/lib/workflow/debug-source-client";
import { useDebugStore } from "./debug-store";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "~/components/ui/dialog";
import { PageLoading } from "~/components/ui/page-loading";
import { useBusyAction } from "~/components/ui/use-busy-action";
import { lastSegments } from "~/lib/path-display";
import { Button } from "~/components/ui/button";
import { OVERLAY_MAX_HEIGHT } from "~/components/ui/overlay-max-height";
import { errorMessage } from "~/lib/error-message";

export type RenderChainModule = {
  /** 完整相对路径（相对项目根，如 src/components/xxx.tsx） */
  file: string;
  /** 标签短名（卡片上显示） */
  label: string;
  /** 分组：canvas=画布级（画布容器/编排/状态层），node=节点级（节点渲染组件/工具）。默认 node。 */
  scope?: "canvas" | "node";
};

const PILL_STYLE: CSSProperties = {
  /* 原生 `<button>` 的默认外观在这里一律还原给药丸样式 —— 换语义不带视觉变化。
   * `font: inherit` 是必需的：`<button>` 默认不继承字体族。 */
  font: "inherit",
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

type SourcePayload = {
  /** 绝对路径（正斜杠盘符格式），供 vscode://file/ 协议打开 */
  absolutePath: string;
  content: string;
  file: string;
  modifiedAt: string;
  size: number;
};

export function DebugChainFooter({ modules }: { modules: Array<RenderChainModule> }) {
  const debugMode = useDebugStore((state) => state.debugMode);

  const [openFile, setOpenFile] = useState<string | null>(null);
  const [source, setSource] = useState<SourcePayload | null>(null);
  /* 忙碌位走唯一出口（规范 16 §16.2.4.71）。 */
  const sourceBusy = useBusyAction();
  const [loadError, setLoadError] = useState<string | null>(null);

  /* 关闭弹窗：Esc 或点击遮罩 / 关闭按钮（Esc 与遮罩由 ui/dialog 负责）。 */
  const closeModal = useCallback(() => {
    setOpenFile(null);
    setSource(null);
    setLoadError(null);
    /* 关弹窗即复位（请求还在飞时也应如此）——出口的 `set` 是给这类
     * 「跨多段 await」的落点用的。 */
    sourceBusy.set(false);
  }, [sourceBusy]);

  const openSource = useCallback(
    async (file: string) => {
      setOpenFile(file);
      setSource(null);
      setLoadError(null);
      try {
        const payload = await sourceBusy.run(() => fetchDebugSource(file));
        setSource(payload);
      } catch (error) {
        setLoadError(errorMessage(error, "读取源码失败"));
      }
    },
    [sourceBusy],
  );

  /* 源码弹窗里的两枚「复制」：成败都**原地改口**（两枚共用一行，闪一下对勾
   * 最省地方；失败时说清怎么自救）。此前这一段完全静默 —— 弹窗里的复制失败
   * 用户看不到任何反应（规范 16 §16.2.4.43）。 */
  const copyOutcome = useFlashState(1400);
  const [copyFailed, setCopyFailed] = useState(false);
  const onCopyText = useCopyFeedback({
    onSuccess: () => {
      setCopyFailed(false);
      copyOutcome.flash();
    },
    onFailure: () => {
      setCopyFailed(true);
    },
  });

  /* 弹窗内容只在 openFile 非空时渲染；提起为局部常量让内部的类型收窄
     （`openFile` 是 `useState<string | null>`）。 */
  const viewedFile = openFile ?? "";

  /* 通过 vscode://file/<absolutePath> 协议在 VSCode 中打开源码文件。
   * 用隐藏 <a> 触发自定义协议，比 window.open 更稳（不被弹窗拦截）。 */
  const openInVscode = useCallback((absolutePath: string) => {
    const uri = `vscode://file/${absolutePath}`;
    const a = document.createElement("a");
    a.href = uri;
    a.style.display = "none";
    document.body.append(a);
    a.click();
    a.remove();
  }, []);

  const pillClick = (
    e: { preventDefault: () => void; stopPropagation: () => void },
    module: RenderChainModule,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    void openSource(module.file);
  };

  if (!debugMode || modules.length === 0) {
    return null;
  }

  /* 按 画布级/节点级 分组展示（scope 缺省视为 node） */
  const canvasModules = modules.filter((m) => (m.scope ?? "node") === "canvas");
  const nodeModules = modules.filter((m) => (m.scope ?? "node") === "node");

  const renderGroup = (title: string, group: Array<RenderChainModule>) => {
    if (group.length === 0) {
      return null;
    }
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
          /* `<Button>` 而不是 `<span onClick>`：span 既不可聚焦、也没有
           *  Enter/Space —— 鼠标点得开、键盘点不开（§6.1：交互元素必须真的
           *  可交互）。悬停说明走 `<Hint>`（P82：视图层的 `<Button>` 不许用
           *  原生 `title=`，读屏器对它的支持长期不一致）。`PILL_STYLE` 的视觉
           *  照旧，`ghost` 变体的底色/文字色由它接管（§16.2.4.2 第 5 条）。 */
          <Hint key={module.file} label={`${module.file}（点击查看源码）`}>
            <Button
              className="h-auto gap-0 px-0 font-normal hover:bg-transparent"
              onClick={(event) => {
                pillClick(event, module);
              }}
              style={PILL_STYLE}
              variant="ghost"
            >
              {module.label}
            </Button>
          </Hint>
        ))}
      </div>
    );
  };

  return (
    <>
      {/* `onPointerDown` / `onMouseDown` / `onDragStart` 都是
          `stopPropagation` / `preventDefault` **守卫**，不是交互。 */}
      {/* oxlint-disable-next-line jsx_a11y/no-static-element-interactions -- 三个都是守卫，不是交互 */}
      <div
        onDragStart={(event) => {
          event.preventDefault();
        }}
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 3,
          padding: "4px 8px 6px",
          borderTop: "1px solid var(--color-border-subtle)",
          background: "var(--color-canvas-deep)",
        }}
      >
        {renderGroup("画布级", canvasModules)}
        {renderGroup("节点级", nodeModules)}
      </div>

      <Dialog
        onOpenChange={(next) => {
          if (!next) closeModal();
        }}
        open={openFile !== null}
      >
        <DialogContent
          className="border-border-strong bg-panel w-[min(860px,92vw)] gap-0 p-0"
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
          // 调试弹窗挂在 ReactFlow 节点内，需阻断指针事件冒泡以免触发节点拖拽。
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          popupClassName={`flex ${OVERLAY_MAX_HEIGHT} flex-col overflow-hidden rounded-2xl`}
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">源码查看</DialogTitle>
          <DialogDescription className="sr-only">
            查看该渲染链路模块的源码，可复制路径或代码。
          </DialogDescription>
          {/* 头部：路径 + 操作按钮 */}
          <div className="border-border-strong flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <span aria-hidden className="text-warning-strong/90 text-sm">
                ◈
              </span>
              <Hint label={viewedFile}>
                <code className="text-ink-bright truncate font-mono text-xs">
                  {/* 路径的语义在尾部（哪个文件）—— CSS `truncate` 只留头部，
                    恰好把它切掉，故显式取末几段。 */}
                  {lastSegments(viewedFile, 3)}
                </code>
              </Hint>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Hint label="在 Visual Studio Code 中打开该文件（需已安装 VSCode）" wrap>
                <Button
                  className="h-auto rounded-md px-2.5 py-1"
                  disabled={!source}
                  onClick={() => {
                    if (source) openInVscode(source.absolutePath);
                  }}
                  size="xs"
                  variant="info"
                >
                  在 VSCode 打开
                </Button>
              </Hint>
              <Hint label={copyFailed ? copyFailureText() : "复制完整相对路径"}>
                <Button
                  className={`h-auto rounded-md px-2.5 py-1 ${
                    copyFailed
                      ? "border-destructive/40 text-danger-strong"
                      : "border-border-strong bg-subtle text-ink-soft hover:bg-surface-2 hover:text-ink-bright"
                  }`}
                  onClick={() => {
                    onCopyText(viewedFile);
                  }}
                  size="xs"
                  variant="outline"
                >
                  {copyFailed ? "复制失败" : copyOutcome.on ? "已复制" : "复制路径"}
                </Button>
              </Hint>
              <Hint label={copyFailed ? copyFailureText() : "复制全部源码"} wrap>
                <Button
                  className="h-auto rounded-md px-2.5 py-1"
                  disabled={!source}
                  onClick={() => {
                    if (source) onCopyText(source.content);
                  }}
                  size="xs"
                  variant="warning"
                >
                  {copyFailed ? "复制失败" : copyOutcome.on ? "已复制" : "复制代码"}
                </Button>
              </Hint>
              <Button
                aria-label="关闭"
                className="border-border-strong bg-subtle text-ink-soft hover:bg-surface-2 hover:text-ink-bright rounded-md"
                onClick={closeModal}
                size="icon-xs"
                variant="outline"
              >
                ✕
              </Button>
            </div>
          </div>
          {/* 内容区 */}
          <div className="bg-canvas-deep min-h-0 flex-1 overflow-auto p-0">
            {sourceBusy.busy && <PageLoading className="py-10 text-xs" label="正在读取源码…" />}
            {!sourceBusy.busy && loadError !== null && loadError !== "" && (
              <div className="text-destructive px-4 py-6 text-xs">读取失败：{loadError}</div>
            )}
            {!sourceBusy.busy && source && (
              <div className="flex flex-col">
                <div className="border-border-subtle bg-subtle text-ink-muted text-2xs flex shrink-0 items-center justify-between border-b px-4 py-1.5 font-mono">
                  <span>{source.size.toLocaleString()} 字符</span>
                  <span>{source.modifiedAt}</span>
                </div>
                {/* key=openFile：切换查看的文件时强制重挂载 CodeBlock，
                        避免复用旧实例的 html/error 状态闪现上一份源码。 */}
                <CodeBlock
                  code={source.content}
                  key={viewedFile}
                  language={extToLanguage(viewedFile)}
                />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
