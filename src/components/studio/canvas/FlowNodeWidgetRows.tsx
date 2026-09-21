"use client";
/* Widget 输入区 —— 只有旋钮（每个条目都带一个 widgets_values
 * 槽位）。从 workflow-node.tsx 抽出。纯连接端口
 * 住在 FlowNodePinRows；本区渲染标量 / 对象输入
 * 及其取值，含 STRING 多行 textarea。 */
import { Handle, Position } from "@xyflow/react";
import { portColor, inferInputType } from "~/lib/comfyui/types";
import { friendlyInputName } from "~/lib/comfyui/node-titles";
import {
  renderWidgetValue,
  valueCellColor,
  sanitizeComboLabel,
} from "../workflow-utils";
import { IoCheckbox, type IOEditContextValue } from "./IOEditContext";
import { StringTextarea } from "../StringTextarea";
import {
  PORT_ROW_TONES,
  portDotGlow,
  resolvePortRowTone,
} from "./flow-focus-endpoints";
import {
  NODE_PORT_FOCUS_ACTIVE_KEY,
  readPortFocusRole,
} from "./hooks/use-related-edges-highlight";
import type { WorkflowNodeData, RawInputMeta } from "../workflow-types";

interface FlowNodeWidgetRowsProps {
  data: WorkflowNodeData;
  io: IOEditContextValue | null;
  rawMeta: Record<string, RawInputMeta>;
  visibleWidgetEntries: [string, unknown][];
  hasSize: boolean;
}

export function FlowNodeWidgetRows({
  data,
  io,
  rawMeta,
  visibleWidgetEntries,
  hasSize,
}: FlowNodeWidgetRowsProps) {
  /* 选中节点时端口行跟着连线一起变（判据与连线同源，见 FlowNodePinRows）：
   *  有连线落到的那一行提亮、端点放大，没有落到的行压暗。级别由
   *  `useRelatedEdgesHighlight` 写在本节点 data 上，行渲染层只读。 */
  const nodeData = data as unknown as Record<string, unknown>;
  const portFocusActive = nodeData[NODE_PORT_FOCUS_ACTIVE_KEY] === true;
  return (
    <div className="relative flex min-h-0 flex-1 flex-col py-0.5">
      {visibleWidgetEntries.map(([k, v], idx) => {
        // 只有当 rawInputs 标它为已连线时，行才带线
        // （少见 —— 主要是兼作默认值的子图包裹输入）。
        const isConn = rawMeta[k]?.isConnection === true;
        // 边界连线：包裹暴露该槽位的哨兵（origin_id -10）。
        const isBoundary =
          rawMeta[k]?.isBoundary === true ||
          data.boundaryInputs?.has(k) === true;
        // 类型一律从 JS 类型的标量值推导（连线元组
        // 的 edgeType 路径在顶部针脚区）。
        const inputType = inferInputType(data.classType, k, v);
        const typeCol = portColor(inputType);
        // Display label: 工作流 JSON 里作者写的 label（英文业务名）优先于
        // ComfyUI 的 zh-CN localized_name —— 与该 pin 在 IO 列表 / 运行期
        // 表单里的取法保持一致（label → localized → name）。localized_name
        // 是通用词（"图像"），排前面会让同一节点上多个 pin 长得一模一样。
        // COMBO 候选串由 sanitizeComboLabel 剥掉；BOOLEAN 描述串（rgthree
        // Settings）保留。
        const meta = rawMeta[k];
        const friendlyLabel =
          sanitizeComboLabel(meta?.label) ||
          sanitizeComboLabel(meta?.localized) ||
          friendlyInputName(k);
        // STRING widget 只有在确实很长 / 多行时才
        // 渲染成堆叠块（标签行 + textarea）；短标量
        //（"auto"、"fp16"）保持紧凑的 22px 行内排布。
        const stringText = typeof v === "string" ? v : "";
        /* 多行只认两件事：服务端按**类型声明**盖的 `multiline`（rawMeta 的
         *  `{"multiline": true}`），以及「值本身很长 / 带换行」这条数据判据 ——
         *  不按字段名猜（叫 prompt 的单行输入不该被升级成 textarea）。 */
        const isStringWidget =
          inputType === "STRING" &&
          (meta?.multiline === true ||
            stringText.length >= 32 ||
            stringText.includes("\n"));

        /* 这一行的观感：widget 行的 Handle id 就是输入名（无前缀）。档位映射收口
         * 在 `PORT_ROW_TONES`（与连接行共用同一张表，避免两处各写一套三元链）。 */
        const tone =
          PORT_ROW_TONES[
            resolvePortRowTone({
              role: readPortFocusRole(nodeData, k),
              hasSelection: portFocusActive,
            })
          ];

        return (
          <div
            // 附加 idx，好让 ComfyUI 的数字槽输入（"1"、"2" …）
            // 不跨行撞车。
            key={`${k}-${idx}`}
            data-input-key={k}
            data-input-type={inputType}
            className={
              isStringWidget
                ? "group relative flex min-h-0 flex-1 flex-col gap-1.5 py-1.5 pr-2 pl-5 text-[11px]"
                : // min-h-[22px] h-auto lets long labels wrap.
                  "group relative flex h-auto min-h-[22px] items-center gap-1.5 py-0.5 pr-2 pl-5 text-[11px]"
            }
            /* 相关行提亮背景、无关行整行压暗（与 FlowNodePinRows 同一张表）。 */
            style={{ background: tone.background, opacity: tone.opacity }}
          >
            {/* 每行都挂一个 target Handle，映射线（对外参数 → 本行）才有锚点：
                React Flow 找不到 handle 会丢弃整条边并打 error#008。未连线的行
                端点保持**完全透明** —— 直接可见的紫点曾经被当成渲染 bug，所以
                这里沿用「没连线就不显示圆点」的观感，只保留连线能力。 */}
            <Handle
              type="target"
              position={Position.Left}
              id={k}
              isConnectable
              className="!h-2.5 !w-2.5 !rounded-full !border"
              style={{
                left: 5,
                background: typeCol,
                opacity: isConn || isBoundary ? 1 : 0,
                /* 相关行的端点放大 + 光晕增强（无连线的行端点仍完全透明）。 */
                width: tone.dotSize,
                height: tone.dotSize,
                boxShadow:
                  isConn || isBoundary
                    ? portDotGlow(typeCol, tone.dotGlowStrong)
                    : undefined,
                borderColor:
                  isConn || isBoundary ? "var(--color-canvas)" : "transparent",
              }}
              title={`${k} (${inputType})`}
            />

            {isStringWidget ? (
              /* STRING 堆叠块 —— 顶部是 LABEL + IoCheckbox，textarea
               * 在下方占满剩余竖向空间。 */
              <div className="flex shrink-0 items-center gap-1.5">
                {io?.ioEditMode && !isConn && !isBoundary && (
                  <IoCheckbox
                    io={io}
                    ioRef={{
                      nodeId: data.nodeId,
                      hostNodeId: data.hostNodeId,
                      name: k,
                      kind: "widget",
                      direction: "input",
                    }}
                  />
                )}
                <span
                  className="shrink-0 text-left text-[11px] break-words whitespace-normal"
                  style={{
                    /* 提亮档统一走表里的色；其余行沿用「连线行比普通行重一档」的
                     * 既有口径（`ink-strong` / `ink-subtle`）。 */
                    color: tone.background
                      ? tone.labelColor
                      : isConn
                        ? "var(--color-ink-strong)"
                        : "var(--color-ink-subtle)",
                    fontWeight: tone.labelWeight,
                  }}
                  title={k}
                >
                  {friendlyLabel}
                </span>
              </div>
            ) : (
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                {/* 工作流输入必须是**未连线**的 —— 对已连线 /
                 *  边界槽位跳过复选框。 */}
                {io?.ioEditMode && !isConn && !isBoundary && (
                  <IoCheckbox
                    io={io}
                    ioRef={{
                      nodeId: data.nodeId,
                      hostNodeId: data.hostNodeId,
                      name: k,
                      kind: "widget",
                      direction: "input",
                    }}
                  />
                )}
                <span
                  className="min-w-0 shrink text-left text-[11px] break-words whitespace-normal"
                  style={{
                    flex: "0 1 auto",
                    color: tone.background
                      ? tone.labelColor
                      : isConn
                        ? "var(--color-ink-strong)"
                        : "var(--color-ink-subtle)",
                    fontWeight: tone.labelWeight,
                  }}
                  title={k}
                >
                  {friendlyLabel}
                </span>

                {/* **同时**带线的 widget 输入仍显示它的
                 * 控件取值（ComfyUI 从不隐藏它）—— 只是调暗，让
                 * 读者能看出这个活值来自连线。
                 *
                 * 版式对齐 ComfyUI：标签与取值之间**不画分隔线**，值紧接标签
                 * 左对齐（此前是一条 1px 竖线 + 右对齐的值列）。 */}
                <span
                  className="min-w-0 truncate text-left text-[10.5px] tabular-nums"
                  style={{
                    flex: "1 1 0",
                    color: valueCellColor(v, isConn),
                  }}
                  title={String(v)}
                >
                  {renderWidgetValue(v)}
                </span>
              </div>
            )}
            {/* STRING widget 文本框 —— **堆叠**在 LABEL 行下方。
             * <textarea readOnly> 胜过 <div> + Tailwind 任意类
             *（它们在这个子树里会静默失效）。值为空时回落到
             * 淡淡的（空）占位。 */}
            {isStringWidget && (
              <div className="flex min-w-0 flex-1 flex-col">
                {stringText.length > 0 ? (
                  <StringTextarea value={stringText} hasSize={hasSize} />
                ) : (
                  <div
                    className="border-border-strong bg-canvas-deep text-ink-fainter rounded border px-2 py-1.5 text-[10.5px] leading-snug"
                    style={{ minHeight: 28 }}
                    title={stringText}
                  >
                    （空）
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
