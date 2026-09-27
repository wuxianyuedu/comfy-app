"use client";

import { PortHandle } from "~/components/studio/workflow-form/DynamicWorkflowForm";
import { Button } from "~/components/ui/button";
import {
  ioLabel,
  splitWorkflowIO,
  typeDisplay,
  type WorkflowIOMap,
} from "~/components/studio/workflow-io";
import { Hint } from "~/components/ui/hint";

/* ── 节点选中时才出现的悬浮工具条 ──
 *  对齐已落地的设计稿：节点上方一枚紧凑胶囊，含 ⌫ 删除（粉）· ⓘ 信息 ·
 *  ● 主题色 · ⛶ 聚焦 · ↶ 撤销 · ⋮ 更多。⌫ 与 ⛶ 已接线，其余是**有意保留的
 *  占位**（只有悬停提示、点击无操作），让界面与设计稿一致、后续可扩展。 */
export function SelectedToolbar({
  onDelete,
  onFocusNode,
  onRedo,
}: {
  onDelete: () => void;
  onFocusNode: () => void;
  /** 提供时（镜头节点）在工具条上出现「退回让 AI 重做」按钮。 */
  onRedo?: () => void;
}) {
  const btn =
    "nodrag nopan text-ink-soft hover:bg-subtle flex h-7 w-7 items-center justify-center rounded-full text-[13px] transition-colors";
  return (
    <div className="nodrag nopan border-border-strong bg-panel border]/95 z-base absolute -top-12 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full px-1 py-1 shadow-lg shadow-black/40 backdrop-blur">
      <Hint label="删除节点 (Delete)" accessibleName>
        <Button
          variant="ghost"
          onClick={onDelete}
          className={`${btn} text-destructive hover:bg-destructive/15`}
        >
          ⌫
        </Button>
      </Hint>
      {onRedo && (
        <Hint label="退回让 AI 重做这一镜" accessibleName>
          <Button
            variant="ghost"
            onClick={onRedo}
            className={`${btn} hover:bg-primary/15`}
          >
            ↺
          </Button>
        </Hint>
      )}
      <Hint label="节点信息" accessibleName>
        <Button variant="ghost" className={btn}>
          ⓘ
        </Button>
      </Hint>
      <Hint label="主题色" accessibleName>
        <Button variant="ghost" className={btn}>
          ●
        </Button>
      </Hint>
      <Hint label="聚焦此节点" accessibleName>
        <Button variant="ghost" onClick={onFocusNode} className={btn}>
          ⛶
        </Button>
      </Hint>
      <Hint label="撤销" accessibleName>
        <Button variant="ghost" className={btn}>
          ↶
        </Button>
      </Hint>
      <Hint label="更多" accessibleName>
        <Button variant="ghost" className={btn}>
          ⋮
        </Button>
      </Hint>
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
