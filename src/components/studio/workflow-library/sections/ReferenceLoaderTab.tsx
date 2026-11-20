"use client";

// ── 工作流库详情「参考图装载」页签（ISSUE #4526：从工坊封装拆出独立成页签）──
// 参考图槽位（reference-image(-n)）的装载配置：每个槽位按预设生成装载链
// （扇出到多端口由参考图挂载节点承担，#4547 起追加端口已移除）。此前这一块
// 混在「工坊封装」页签里，多参考图工作流的装载配置与契约口清单挤在一屏；
// 拆出后各自一屏。配置项与写回口径不变：仍落 `paramMap` 的
// `referenceLoaders.mode:<模式>` 命名空间（见 `ReferenceLoaderBindingSection` 文件头）。
// #4588/#4593：同页签补「挂载节点」面板——编辑器里点选的挂载节点在这里按名字
// 列出，不必进编辑器就能看到参考图挂在了什么节点。

import { FolderOpen, Waypoints } from "lucide-react";

import type { WorkflowIOMap } from "~/components/studio/workflow-io";
import {
  referenceLoaderMountNodes,
  resolveReferenceMountNodes,
  type ReferenceMountNode,
} from "~/lib/workshop/reference-loader-binding";
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
  /** 工作流 RAW 原件（挂载节点 id → 展示名就由它解析）。 */
  rawJson?: unknown;
};

/** 页签级空态：居中一条说明（与详情面板的「在左侧选择一个工作流」同款形态）。 */
function TabEmpty({ text }: { text: string }) {
  return (
    <div className="text-ink-fainter flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
      <div className="border-border bg-subtle flex size-16 items-center justify-center rounded-2xl border">
        <FolderOpen className="size-7 opacity-40" />
      </div>
      <p className="text-sm">{text}</p>
    </div>
  );
}

/** 挂载节点面板（ISSUE #4593）：编辑器「参考图挂载」编辑态点选的节点，在这里
 *  按名字列出——不进编辑器也能看到参考图挂在了什么节点。 */
function MountedNodesPanel({ nodes }: { nodes: ReadonlyArray<ReferenceMountNode> }) {
  return (
    <div className="border-border/60 bg-surface rounded-xl border p-3">
      <div className="flex items-center gap-2">
        <Waypoints className="text-primary-strong size-3.5 shrink-0" />
        <p className="text-ink text-xs font-medium">参考图挂载节点（{nodes.length}）</p>
      </div>
      <p className="text-muted-foreground/70 text-3xs mt-0.5">
        编辑器「参考图挂载」编辑态里点选的节点；参考图槽位按 image_0..N 自动接线到这些节点的图片口。
      </p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {nodes.map((node) => (
          <li
            className="border-border/60 bg-panel text-ink text-2xs rounded-lg border px-2 py-1"
            key={node.id}
            title={node.id}
          >
            {node.title}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ReferenceLoaderTab({
  activeMode,
  io,
  onPatchParamMap,
  paramMap,
  rawJson,
}: ReferenceLoaderTabProps) {
  /* 契约口清单与「工坊封装」同一份取数（useWorkflowEncapsulation）：
   * 参考图槽位是契约口的一个子集（id 形如 reference-image(-n)）。 */
  const { status } = useWorkflowEncapsulation({ mode: activeMode, io, paramMap });
  const hasSlots = status.entries.some((entry) => referenceSlotOf(entry.id) >= 0);
  /* 挂载节点（#4593）：paramMap 里是 id 名单，名字从 RAW 图解析。 */
  const mountNodes = resolveReferenceMountNodes({
    mountNodeIds: referenceLoaderMountNodes(paramMap),
    rawJson,
  });
  const mountPanel = mountNodes.length > 0 ? <MountedNodesPanel nodes={mountNodes} /> : null;

  if (activeMode === null || activeMode === "" || onPatchParamMap === undefined) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {mountPanel}
        <TabEmpty text="当前没有可配置的模式，参考图装载不可用" />
      </div>
    );
  }
  if (!hasSlots) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {mountPanel}
        <TabEmpty text="这条工作流没有参考图槽位（reference-image）" />
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {mountPanel}
      <ReferenceLoaderBindingSection
        entries={status.entries}
        mode={activeMode}
        onPatchParamMap={onPatchParamMap}
        paramMap={paramMap}
      />
    </div>
  );
}
