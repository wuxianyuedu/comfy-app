"use client";

import { PortHandle } from "~/components/studio/shared/DynamicWorkflowForm";
import {
  ioLabel,
  splitWorkflowIO,
  typeDisplay,
  type WorkflowIOMap,
} from "~/components/studio/shared/workflow-io";

/* ── Floating toolbar shown only when the node is selected ──
 *  Matches the landed design spec: a compact pill above the node with
 *  ⌫ delete (pink) · ⓘ info · ● colour · ⛶ focus · ↶ undo · ⋮ more.
 *  ⌫ and ⛶ are wired; the rest are intentional affordances (no-ops with
 *  titles) so the surface matches the spec and can be extended later. */
export function SelectedToolbar({
  onDelete,
  onFocusNode,
}: {
  onDelete: () => void;
  onFocusNode: () => void;
}) {
  const btn =
    "nodrag nopan text-ink-soft hover:bg-subtle flex h-7 w-7 items-center justify-center rounded-full text-[13px] transition-colors";
  return (
    <div className="nodrag nopan border-border-strong bg-panel border]/95 absolute -top-12 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-full px-1 py-1 shadow-lg shadow-black/40 backdrop-blur">
      <button
        type="button"
        title="删除节点 (Delete)"
        onClick={onDelete}
        className={`${btn} text-rose-700 hover:bg-rose-500/15 dark:text-rose-300`}
      >
        ⌫
      </button>
      <button type="button" title="节点信息" className={btn}>
        ⓘ
      </button>
      <button type="button" title="主题色" className={btn}>
        ●
      </button>
      <button
        type="button"
        title="聚焦此节点"
        onClick={onFocusNode}
        className={btn}
      >
        ⛶
      </button>
      <button type="button" title="撤销" className={btn}>
        ↶
      </button>
      <button type="button" title="更多" className={btn}>
        ⋮
      </button>
    </div>
  );
}

/* 输出样式对齐 WorkflowNode.outputs row
 *  — label + 右侧 typeChip（#26262E/#9A9AAD）+ PortHandle 端点。
 *  image / video / script 节点通用。当工作流未选（wfIO 为 null）时
 *  回退到节点类型的默认 label/type，确保 Handle 始终可连。 */
export function OutputRowPort({
  kind,
  wfIO,
}: {
  kind: "image" | "video" | "script";
  wfIO?: WorkflowIOMap | null;
}) {
  const outputs = wfIO ? splitWorkflowIO(wfIO).outputs : [];
  const o = outputs[0];
  const fallbackType: string =
    kind === "video" ? "VIDEO" : kind === "script" ? "STRING" : "IMAGE";
  const fallbackLabel: string =
    kind === "video" ? "视频" : kind === "script" ? "结果" : "图像";
  const outLabel = o ? ioLabel(o, outputs) : fallbackLabel;
  const outType = o?.type ?? fallbackType;
  const outKey = o?.ioKey ?? "output";
  return (
    <div className="relative">
      <PortHandle
        id={outKey}
        dir="out"
        type={outType}
        style={{
          right: -6,
          top: 14,
          transform: "translateY(-50%)",
          boxShadow: "none",
        }}
      />
      <div className="flex h-5 items-center justify-end gap-1.5 px-[14px] pt-1.5">
        <span
          className="text-ink-bright min-w-0 truncate text-[12px] font-semibold"
          style={{ fontFamily: "var(--font-sans)" }}
          title={`IO 输出 · ${outLabel}${outType ? ` · ${outType}` : ""}`}
        >
          {outLabel}
        </span>
        <span
          className="bg-border-strong text-ink-muted inline-flex shrink-0 items-center rounded-[3px] px-1.5 py-0.5 text-[10px] font-semibold"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          {typeDisplay(outType)}
        </span>
      </div>
      <div className="pb-2" />
    </div>
  );
}
