"use client";
/* 子图封装节点上的 STRING widget 堆叠块 —— 标签行 + 只读多行文本框，
 * 堆叠在 LABEL 行**下方**（与 WorkflowNode 对齐）。行是
 * `flex-col gap-1.5 flex-1`，好让标签 + 字数章占住顶行、
 * 下面的 textarea 填满剩下的竖向空间。
 *
 * 与 WorkflowNode 分支配对：真正的 <textarea readOnly>
 * 让多行提示自动换行，溢出部分原生滚动
 * （不依赖 Tailwind className —— WorkflowNode
 * 子树历史上对任意值 className
 * 编译不可靠）。子图包裹 widget 用 `mono` 字体
 * （它们通常是系统名 / ID）。值为空时
 * 回落到淡淡的「（空）」占位，仍占住
 * flex-1 容器，行布局保持均衡。 */
import { StringTextarea } from "../StringTextarea";
import { IoCheckbox, type IOEditContextValue } from "./IOEditContext";
import type { RawInputMeta } from "../workflow-types";

/** 该 widget 槽是否按「上下堆叠」渲染成多行文本框：服务端盖的
 *  `multiline` 章（节点类型声明 `("STRING", {"multiline": true})`）加上
 *  「值很长 / 含换行」两条数据启发式 —— 不按字段名猜。行布局（grid 行轨道
 *  是内容高还是 1fr）与渲染分支都要用它，收口一处。 */
export const stackedStringRow = (inp: RawInputMeta): boolean => {
  const text = typeof inp.widgetValue === "string" ? inp.widgetValue : "";
  return (
    inp.isConnection !== true &&
    inp.isBoundary !== true &&
    inp.type === "STRING" &&
    (inp.multiline === true || text.length >= 32 || text.includes("\n"))
  );
};

interface SubgraphWidgetStackedStringProps {
  inp: RawInputMeta;
  label: string;
  io: IOEditContextValue | null;
  nodeId: string;
  hostNodeId?: string;
  /** 定尺寸节点（导入配置带显式尺寸）时 textarea 接入 flex 链填满剩余高度。 */
  hasSize: boolean;
}

export function SubgraphWidgetStackedString({
  inp,
  label,
  io,
  nodeId,
  hostNodeId,
  hasSize,
}: SubgraphWidgetStackedStringProps) {
  const v: unknown = inp.widgetValue;
  const isConn = inp.isConnection === true || inp.isBoundary === true;
  const stringText: string = typeof v === "string" ? v : "";
  return (
    <div
      /* STRING widget 上下堆叠：标签 + 字数章占顶行，
       *  textarea 借行轨道的 `1fr` 填满剩余竖向空间。 */
      className="group relative flex min-h-0 flex-col gap-1.5 py-1.5 pr-2 pl-5 text-[11px]"
      style={{ gridColumn: "1 / -1" }}
      data-sub-widget-name={inp.name}
      data-sub-widget-value={String(v)}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-1.5">
          {io?.ioEditMode && !isConn && (
            <IoCheckbox
              io={io}
              ioRef={{
                nodeId: String(nodeId),
                hostNodeId,
                name: inp.name,
                kind: "widget",
                direction: "input",
              }}
            />
          )}
          <span
            /* 子图 STRING 堆叠行的标签同样去掉 `truncate` ——
             *  理由与 WorkflowNode 内联分支相同。 */
            className="shrink-0 text-left text-[11px] wrap-break-word whitespace-normal"
            style={{
              color: isConn
                ? "var(--color-ink-strong)"
                : "var(--color-ink-subtle)",
            }}
            title={label}
          >
            {label}
          </span>
          {/* 标签与字数之间同样不画分隔线（与 ComfyUI 同款版式）。 */}
          <span
            className="text-ink-muted text-right text-[10px] tracking-wider uppercase"
            title={`STRING · ${stringText.length} chars`}
          >
            {stringText.length}c
          </span>
        </div>
        {stringText.length > 0 ? (
          <StringTextarea value={stringText} mono hasSize={hasSize} />
        ) : (
          <div
            className="border-border-strong bg-canvas-deep text-ink-fainter flex-1 rounded border px-2 py-1.5 text-[10.5px] leading-snug"
            style={{ minHeight: 28 }}
          >
            （空）
          </div>
        )}
      </div>
    </div>
  );
}
