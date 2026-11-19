"use client";

// ── 工作流库详情「参考图装载」页签（ISSUE #4526：从工坊封装拆出独立成页签）──
// 参考图槽位（reference-image(-n)）的装载配置：每个槽位按预设生成装载链
// （扇出到多端口由参考图挂载节点承担，#4547 起追加端口已移除）。此前这一块
// 混在「工坊封装」页签里，多参考图工作流的装载配置与契约口清单挤在一屏；
// 拆出后各自一屏。配置项与写回口径不变：仍落 `paramMap` 的
// `referenceLoaders.mode:<模式>` 命名空间（见 `ReferenceLoaderBindingSection` 文件头）。

import { FolderOpen } from "lucide-react";

import type { WorkflowIOMap } from "~/components/studio/workflow-io";
import { referenceSlotOf } from "~/lib/workshop/workflow-encapsulation";

import { useWorkflowEncapsulation } from "../hooks/use-workflow-encapsulation";
import { ReferenceLoaderBindingSection } from "../reference-loader/ReferenceLoaderBindingSection";

type ReferenceLoaderTabProps = {
  /** 当前查看模式（详情层持有；空 = 没有模式语境，无从按模式存绑定）。 */
  activeMode: string | null;
  io: WorkflowIOMap | null;
  /** 整份 paramMap 的写回口；缺省 = 本页签不可配置（如实给空态）。 */
  onPatchParamMap?: (next: Record<string, unknown>) => Promise<void> | void;
  paramMap: Record<string, unknown>;
};

/** 页签级空态：居中一条说明（与详情面板的「在左侧选择一个工作流」同款形态）。 */
function TabEmpty({ text }: { text: string }) {
  return (
    <div className="text-ink-fainter flex h-full flex-col items-center justify-center gap-3">
      <div className="border-border bg-subtle flex size-16 items-center justify-center rounded-2xl border">
        <FolderOpen className="size-7 opacity-40" />
      </div>
      <p className="text-sm">{text}</p>
    </div>
  );
}

export function ReferenceLoaderTab({
  activeMode,
  io,
  onPatchParamMap,
  paramMap,
}: ReferenceLoaderTabProps) {
  /* 契约口清单与「工坊封装」同一份取数（useWorkflowEncapsulation）：
   * 参考图槽位是契约口的一个子集（id 形如 reference-image(-n)）。 */
  const { status } = useWorkflowEncapsulation({ mode: activeMode, io, paramMap });
  const hasSlots = status.entries.some((entry) => referenceSlotOf(entry.id) >= 0);

  if (activeMode === null || activeMode === "" || onPatchParamMap === undefined) {
    return <TabEmpty text="当前没有可配置的模式，参考图装载不可用" />;
  }
  if (!hasSlots) {
    return <TabEmpty text="这条工作流没有参考图槽位（reference-image）" />;
  }
  return (
    <ReferenceLoaderBindingSection
      entries={status.entries}
      mode={activeMode}
      onPatchParamMap={onPatchParamMap}
      paramMap={paramMap}
    />
  );
}
