"use client";
/* 子图封装节点的非 STRING widget 行 —— 标签 | 值框 两格行；行跨满两列并
 * 借用父 grid 的列轨道（subgrid），标签列宽 = 全部行里最长参数名，
 * 值框起点逐行一致。值格按 widget 类型三分支：
 *   • 图片类（IMAGE / MASK / IMAGEUPLOAD）→ 缩略图；
 *   • COMBO（带候选清单）→ 只读 SelectMenu；
 *   • 其余 → 「凹陷井」文本值。
 */
import { Handle, Position } from "@xyflow/react";
import { portColor } from "~/lib/comfyui/types";
import { SelectMenu } from "~/components/ui/select-menu";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { mediaPreviewUrl } from "~/lib/media/media-url";
import { renderSubgraphWidgetValue, valueCellColor } from "../workflow-utils";
import { IoCheckbox, type IOEditContextValue } from "./IOEditContext";
import type { RawInputMeta } from "../workflow-types";

/** COMBO 输入额外携带自己的候选清单（由导入管线盖章；
 *  不属于共享的 RawInputMeta 契约）。 */
type ComboInputMeta = RawInputMeta & { comboOptions?: unknown };

interface SubgraphWidgetRowProps {
  inp: RawInputMeta;
  label: string;
  io: IOEditContextValue | null;
  nodeId: string;
  hostNodeId?: string;
}

export function SubgraphWidgetRow({
  inp,
  label,
  io,
  nodeId,
  hostNodeId,
}: SubgraphWidgetRowProps) {
  const v: unknown = inp.widgetValue;
  const isConn = inp.isConnection === true || inp.isBoundary === true;
  /* 图片类 widget（IMAGE / MASK / IMAGEUPLOAD）：画布上也要把选中的图
   *  显示出来 —— 此前这类 widget 只渲染成纯文本值（甚至因为值是 ComfyUI
   *  的 `{filename,subfolder,type}` 对象 / 数组而显示成 `[object Object]`），
   *  于是「封装节点选完图在界面上完全看不到」（实测反馈）。这里按类型
   *  切到缩略图；`mediaPreviewUrl` 同时吃字符串与这两种对象 / 数组形态。 */
  const isImageType = ["IMAGE", "MASK", "IMAGEUPLOAD"].includes(inp.type ?? "");
  const previewUrl = isImageType ? mediaPreviewUrl(v) : null;
  const typeCol = portColor(inp.type);
  return (
    <div
      className="group relative grid min-h-5.5 py-0.5 pr-2 pl-5 text-[11px]"
      style={{
        gridColumn: "1 / -1",
        gridTemplateColumns: "subgrid",
        alignItems: "center",
      }}
      data-sub-widget-name={inp.name}
      data-sub-widget-value={String(v)}
    >
      {isConn && (
        <Handle
          type="target"
          position={Position.Left}
          id={inp.name}
          isConnectable={false}
          className="border-port-surface! size-2.5! rounded-full! border!"
          style={{
            left: 5,
            background: typeCol,
            boxShadow: `0 0 6px ${typeCol}AA, inset 0 0 0 1px var(--color-port-surface)`,
          }}
          title={`${label} (${inp.type})`}
        />
      )}
      {/* 标签格（第 1 列）：IO 复选框 + 标签。列宽由父 grid 的
       *  `max-content` 轨道按**所有行里最长的参数名**统一裁决，
       *  值框因此共享同一起点 x。 */}
      <div className="flex min-w-0 items-center gap-1.5">
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
          /* 去掉 `truncate`：让长的封装 widget 标签换成多行
           *  而不是被裁掉；完整文本仍可从原生 `title` 看到。 */
          className="min-w-0 text-left text-[11px] wrap-break-word whitespace-normal"
          style={{
            color: isConn
              ? "var(--color-ink-strong)"
              : "var(--color-ink-subtle)",
          }}
          title={label}
        >
          {label}
        </span>
      </div>
      {isImageType ? (
        /* 图片类 widget 在画布上直接渲染缩略图（否则只显示成文本值，
         *  且 ComfyUI 把 IMAGE 输入存成 `{filename,subfolder,type}`
         *  对象 / 数组时还会显示成 `[object Object]`）—— 封装节点选完图
         *  「在界面上完全看不到」（实测反馈）。`src` 为 null 时
         *  MediaThumbnail 按 fallback 不渲染任何东西，与「未选图」一致。 */
        <MediaThumbnail
          src={previewUrl}
          alt={label}
          fallback="none"
          className="border-border-strong bg-canvas-deep mt-0.5 max-h-24 w-full rounded-[5px] border object-contain"
        />
      ) : inp.type === "COMBO" &&
        Array.isArray((inp as ComboInputMeta).comboOptions) &&
        ((inp as ComboInputMeta).comboOptions as unknown[]).length > 0 ? (
        /* 工作流画布上的 COMBO widget 渲染成只读的
         *  SelectMenu —— 它把当前选中的模型显示成下拉外壳，但
         *  在这里保持禁用（编辑发生在会落盘取值的项目
         *  画布表单里）。这个节点是忠实的只读预览，不是编辑器。
         *  触发器铺满第 2 列（`fullWidth`），与值框同一坐标。 */
        <SelectMenu
          value={typeof v === "string" ? v : ""}
          onChange={() => undefined}
          options={(inp as ComboInputMeta).comboOptions as string[]}
          disabled
          fullWidth
          className="h-5.5! min-w-0 py-0! text-[11px]!"
          popoverMinWidth={220}
        />
      ) : (
        <span
          className="min-w-0 truncate rounded-[5px] px-1.5 text-left text-[10.5px] tabular-nums"
          style={{
            /* 值框：ComfyUI widget 槽同款「凹陷井」—— 深底 +
             *  细描边。宽度 = 第 2 列整格（最小 64px，随节点
             *  余宽伸展），文本左对齐，超长省略（只缩略文字，
             *  节点宽度仍由用户控制）。颜色按「有没有连线」
             *  取两档（见 `valueCellColor`）。 */
            display: "flex",
            alignItems: "center",
            minHeight: 18,
            background: "var(--color-canvas-deep)",
            border: "1px solid var(--color-border-subtle)",
            color: valueCellColor(v, isConn),
          }}
          title={String(v)}
        >
          {renderSubgraphWidgetValue(v)}
        </span>
      )}
    </div>
  );
}
