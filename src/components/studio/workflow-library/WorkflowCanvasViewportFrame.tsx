"use client";

/* 工作流库「画布节点」预览的**视口外框**：拖动平移、滚轮缩放、适应/复位。
 *
 * 用户诉求：「这里需要可以拖动整个画布查看其他超出边框的内容」（ISSUE #355）。
 * 三列（对外参数卡片列 + 宿主卡片 + 对外输出参数卡片列）合起来常宽过面板，
 * 超出去的部分此前根本看不到 —— 外框把内容整层平移 / 缩放，并给出一条回到
 * 「刚好放得下」的出口。
 *
 * 为什么单独成一个组件：平移/缩放的状态与手势只在这一层，预览主体（表单、卡片、
 * 运行态）不该因为「拖了一下画布」而整块重渲染 —— 状态边界就是渲染边界。
 *
 * 只读：不碰映射、不碰连线。连线量测读的是被平移后的真实 DOM 矩形，所以拖动画布
 * 不会让线错位。
 */

import { useEffect, useRef, type ReactNode } from "react";

import { useLibraryCanvasViewport } from "./hooks/use-library-canvas-viewport";

export interface WorkflowCanvasViewportFrameProps {
  /** 顶栏左侧的说明文案（外框只负责摆放，文案由调用方给）。 */
  hint: string;
  /** 顶栏右侧的额外出口（预览层放「显示连线」这类开关）。 */
  toolbar?: ReactNode;
  children: ReactNode;
}

export function WorkflowCanvasViewportFrame({
  hint,
  toolbar,
  children,
}: WorkflowCanvasViewportFrameProps) {
  const viewport = useLibraryCanvasViewport();
  /* 两个元素用**本地 ref + effect** 交给视口，而不是把 hook 返回的回调直接喂给
   *  `ref=`：后者会让 react-hooks/refs 把整个 controller 判成 ref 对象，连
   *  `transform` 这类正常读取都拦下（见 controller 上的说明）。 */
  const frameElRef = useRef<HTMLDivElement | null>(null);
  const contentElRef = useRef<HTMLDivElement | null>(null);
  const { setFrameElement, setContentElement } = viewport;
  useEffect(() => {
    setFrameElement(frameElRef.current);
    return () => setFrameElement(null);
  }, [setFrameElement]);
  useEffect(() => {
    setContentElement(contentElRef.current);
    return () => setContentElement(null);
  }, [setContentElement]);

  return (
    <div
      ref={frameElRef}
      className="relative w-full overflow-hidden rounded-xl border border-border-subtle bg-panel-deep"
      data-testid="wflib-canvas-viewport"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-1.5">
        <span className="text-[10.5px] text-ink-fainter">{hint}</span>
        <div className="flex items-center gap-1">
          <span
            className="rounded px-1.5 py-px font-mono text-[10px] text-ink-faint"
            data-testid="wflib-canvas-zoom"
          >
            {viewport.zoomText}
          </span>
          {toolbar}
          <button
            type="button"
            onClick={viewport.fit}
            className="rounded border border-border-strong px-2 py-0.5 text-[10.5px] text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink-bright"
            data-testid="wflib-canvas-fit"
          >
            适应
          </button>
          <button
            type="button"
            onClick={viewport.reset}
            disabled={viewport.isIdentity}
            className={`rounded border border-border-strong px-2 py-0.5 text-[10.5px] transition-colors ${
              viewport.isIdentity
                ? "cursor-default text-ink-fainter"
                : "text-ink-soft hover:bg-surface-2 hover:text-ink-bright"
            }`}
            data-testid="wflib-canvas-reset"
            title={viewport.isIdentity ? "已是初始视口" : "回到初始视口"}
          >
            复位
          </button>
        </div>
      </div>
      {/* 内容层：**唯一**被平移 / 缩放的一层。内边距撑出可拖动的空白区 ——
          沿卡片之间或卡片外按下都能起手，不必精确去摸某条缝。
          外框 `overflow-hidden`：超出边界的内容被裁掉，不再去顶整页的横向滚动。 */}
      <div
        className="min-h-[320px] w-full overflow-hidden p-10"
        onPointerDown={(event) => {
          /* 卡片**内部**的按下不属于「拖画布」：表单控件、端口圆点、连线端点、
           *  参数行上的按下都有自己的手势（填值 / 拖线 / 改落点）。平移面是包住
           *  所有卡片的那一层，不筛一下就会把手势抢走 —— 表现是「按住节点上任何
           *  地方都在平移整块内容」，连线时目标行跟着画布跑，根本落不上点。
           *  空白处（卡片之间、卡片外）仍可起手平移。 */
          const el = event.target as HTMLElement | null;
          if (
            el?.closest(
              "input, textarea, select, button, a, label, [data-port-dot], [data-wire-anchor], [data-io-key], [data-io-pins], [data-pin-anchor]",
            )
          ) {
            return;
          }
          viewport.onPointerDown(event);
        }}
        data-testid="wflib-canvas-pan-surface"
      >
        <div
          ref={contentElRef}
          className="origin-top-left will-change-transform"
          style={{ transform: viewport.transform }}
          data-testid="wflib-canvas-content"
        >
          {children}
        </div>
      </div>
    </div>
  );
}
