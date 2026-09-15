/**
 * WorkflowNode.tsx — 自定义工作流节点的「设计驱动 + 功能承载」组件（内容层）。
 *
 * 视觉严格对齐 Ardot 稿 714503087315759（v2）：frame 3:12 NodeCard-v2。
 * 本文件是「测试自定义工作流」纯视觉稿（WorkflowNodeArdot.tsx）的功能版——
 * 同样的视觉元素（Card / Header / 3-chip / 端口行 / 生成按钮），叠加运行时逻辑：
 * NodeProps 数据、splitWorkflowIO 动态端口、生成按钮状态机。
 *
 * 与纯视觉稿的边界（按用户「除了测试节点有的元素，不要多加」）：
 *  - 不引入内层面板 #0B0B10（稿无）
 *  - 不引入结果卡 / 替换按钮（稿无，后续再补）
 *  - 端口 Handle 与稿一致：12px、描边 in #4D4D59 / out #16161C、投影、骑跨卡边
 *
 * 3 个 chip 改为真正的「独立 dropdown」——之前 3 个 chip
 *  共享同一个 `open` state + 同一个 popover（点哪个都展同一个），用户体感"不是
 *  独立的"。新版每个 chip 自己控 open、自己位置、自己列表：
 *    ① SourceFilterChip（本机 / 在线 / 全部）— popover 内 3 radio
 *    ② WorkflowPickChip（受 SourceFilter 过滤的工作流列表）— popover 列名
 *    ③ ModePickChip（按当前工作流的 modes 配置多选 + 默认）— popover 完整 multi-select
 *  增加 ④ ModelFilterChip（按用户模型标签库筛选）。
 *
 * 外壳（Card 圆角14、无 overflow-hidden 以保护 Handle 骑跨）由 CanvasNode 持有。
 *
 * 4 个 chip 与 popover 通用逻辑已拆出：
 *  - workflow-node-popover.ts        — 定位 / 外部点击关闭基元
 *  - WorkflowSourceFilterChip.tsx    — 来源筛选 chip
 *  - WorkflowModelFilterChip.tsx     — 模型标签筛选 chip
 *  - WorkflowPickChip.tsx            — 工作流选择 chip
 *  - WorkflowModePickChip.tsx        — 模式选择 chip（含 transform 自动关闭）
 *  本文件保留类型定义与节点组装逻辑，外部导出 API 不变。
 */
"use client";

import React from "react";
import { useStore } from "@xyflow/react";
import {
  DynamicWorkflowForm,
  PortHandle,
} from "@/components/studio/shared/DynamicWorkflowForm";
import {
  type WorkflowIOMap,
  splitWorkflowIO,
  ioLabel,
  typeDisplay,
} from "@/components/studio/shared/workflow-io";
import { type CanvasNodeData, NODE_META } from "@/lib/project-canvas/canvas-types";
import {
  type WorkflowSourceFilter,
  type WorkflowModesState,
} from "./workflow-node-types";
import { WorkflowSourceFilterChip } from "./WorkflowSourceFilterChip";
import { WorkflowModelFilterChip } from "./WorkflowModelFilterChip";
import { WorkflowPickChip } from "./WorkflowPickChip";
import { WorkflowModePickChip } from "./WorkflowModePickChip";

/* 共享类型下沉到叶子模块（断环，规范 12.7/18）；按原样 re-export 保住既有导入路径。 */
export type { WorkflowSourceFilter, WorkflowModesState } from "./workflow-node-types";

export interface WorkflowNodeProps {
  id: string;
  data: CanvasNodeData;
  /** 该工作流暴露的 IO 映射（来自 GET /api/workflows/[id]）。 */
  workflowIO: WorkflowIOMap | null;
  workflowIOLoading: boolean;
  /** 工作流列表是否仍在加载。为 true 时工作流选择区显示"加载中"而非空态。 */
  workflowListLoading?: boolean;
  /** 完整工作流列表（含 sourcePath / taskType）。 */
  workflowList: {
    id: string;
    name: string;
    taskType?: string;
    sourcePath?: string | null;
    modelTags?: string[];
  }[];
  /** 当前工作流的 modes 配置（来自 /api/workflows/[id] 的 modes/defaultMode）。 */
  workflowModes?: WorkflowModesState | null;
  /** 父级（CanvasNode）持的来源筛选 — 影响 chip2 列表。 */
  sourceFilter?: WorkflowSourceFilter;
  /** 用户级模型标签库（全局），驱动 chip4 的模型筛选列表。 */
  modelTagLib?: { id: string; name: string; count: number }[];
  /** 画布节点会话级模型筛选值（"all" 或某标签名）。 */
  modelFilter?: string;
  onPatch: (p: Partial<CanvasNodeData>) => void;
  onSourceFilterChange: (f: WorkflowSourceFilter) => void;
  onModelFilterChange?: (f: string) => void;
  onGenerate: () => void;
  onSelectWorkflow: (v: string) => void;
  onFormChange: (next: Record<string, unknown>) => void;
  onSeedModeChange: (ioKey: string, mode: string) => void;
  onModesChange: (modes: string[], defaultMode: string) => void;
}

export function WorkflowNode({
  id,
  data: d,
  workflowIO,
  workflowIOLoading,
  workflowListLoading = false,
  workflowList,
  workflowModes,
  sourceFilter = "all",
  modelTagLib = [],
  modelFilter = "all",
  onSourceFilterChange,
  onModelFilterChange,
  onGenerate,
  onSelectWorkflow,
  onFormChange,
  onSeedModeChange,
  onModesChange,
}: WorkflowNodeProps) {
  const meta = NODE_META[d.kind];

  /* 右上角显示「短序号」#1/#2…（按画布节点列表顺序）。
   * useStore 选择器结果不变时不触发重渲染：拖动/选中只改位置不改变 index，
   * 仅节点增删导致序号变化时才重渲染此节点。完整 id 保留在 title 中。 */
  const nodeSeq = useStore((state) => {
    const idx = state.nodes.findIndex((node) => node.id === id);
    return idx === -1 ? null : idx + 1;
  });

  /* 在所有输入参数下方渲染 outputs row — 用户在
   *  IO-edit 配的 output 在画布节点上要可见。Header (h-8) 不放，回到 Ardot
   *  设计稿 v2 的「W + 标题 + 状态胶囊」三件套；outputs 单独成段放在
   *  DynamicWorkflowForm 之后、生成按钮之前。
   *  outputs 视觉与 inputs 严格对齐成「双行结构」—
   *  第 1 行 labelRow（IO 紫点 + label + COMBO typeChip），第 2 行 dim 占位
   *  控件（h-28 与 inputs 控件行同高），端点 PortHandle 放最右（dir="out",
   *  right:-6）。`inputs` 一并解构出来给 ioLabel() 用作组内去重。 */
  const { inputs, outputs } = splitWorkflowIO(workflowIO);

  /* 按 sourceFilter 过滤 chip2 列表 — 让 chip1 真正参与决策。
   * 叠加模型筛选 — chip4 选中的标签名必须命中工作流的 modelTags。 */
  const filteredList = workflowList
    .filter((workflowList) => {
      if (sourceFilter === "all") return true;
      if (sourceFilter === "local") return Boolean(workflowList.sourcePath);
      return !workflowList.sourcePath;
    })
    .filter((workflow) => {
      if (modelFilter === "all") return true;
      const tags = workflow.modelTags ?? [];
      return tags.includes(modelFilter);
    });

  return (
    <>
      {/* 头部：W 图标 + 标题 + 状态胶囊（Ardot token，与测试节点一致） */}
      <div className="flex h-8 min-w-0 items-center justify-between gap-2 pr-[14px] pl-[14px]">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-label="类型 工作流"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[14px] text-[14px] font-bold text-primary"
            style={{ background: "#2A1F4A", fontFamily: "var(--font-sans)" }}
          >
            W
          </span>
          <span
            className="truncate text-[14px] font-bold text-ink-bright"
            style={{ fontFamily: "var(--font-sans)" }}
            title={meta.label}
          >
            {meta.label}
          </span>
        </div>
        <div
          className="flex h-5 shrink-0 items-center gap-[5px] rounded-[11px] bg-overlay-accent-surface px-2"
          title={`项目画布节点 Id：${id}`}
        >
          <span
            className="font-mono text-[10px] font-semibold text-cyan-700 dark:text-cyan-200"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {nodeSeq !== null
              ? `#${nodeSeq}`
              : `#${id.length > 10 ? id.slice(0, 9) + "…" : id}`}
          </span>
        </div>
      </div>

      {/* 分隔线 340×1 #26262E */}
      <div className="h-px bg-border-strong" />

      {/* 拆双行 — 头部窄节点挤 4 chip，按用户给优先级排。
       *   Row 1 (高优先级，筛选类)  ① SourceFilterChip + ④ ModelFilterChip
       *   Row 2 (中优先级，配置类)  ② WorkflowPickChip (flex-1) + ③ ModePickChip
       *  之前单行 h-11 在 ~300px 节点宽度下 WorkflowPickChip 被压
       *  截断成 "ima..."。拆行后 WorkflowPickChip 独占一行可读全名。 */}
      <div className="flex flex-col gap-1 pr-[14px] pb-1.5 pl-[14px]">
        {/* Row 1 — 高优先级筛选 chip：来源 + 模型 */}
        <div className="flex h-7 min-w-0 items-center gap-1">
          <WorkflowSourceFilterChip
            value={sourceFilter}
            onChange={onSourceFilterChange}
          />
          <WorkflowModelFilterChip
            value={modelFilter}
            tags={modelTagLib}
            onChange={(value) => onModelFilterChange?.(value)}
          />
        </div>
        {/* Row 2 — 配置 chip：当前所选工作流 (flex-1) + 模式 */}
        <div className="flex h-7 min-w-0 items-center gap-1">
          <WorkflowPickChip
            value={d.workflowId ?? ""}
            options={filteredList}
            onSelect={onSelectWorkflow}
            loading={workflowListLoading}
            emptyHint={
              sourceFilter !== "all"
                ? `当前筛选下没有工作流，切换「${sourceFilter === "local" ? "本机" : "在线"}」试试`
                : modelFilter !== "all"
                  ? `当前模型「${modelFilter}」下没有工作流`
                  : "暂无工作流，先去工作流库导入"
            }
          />
          <WorkflowModePickChip
            modes={workflowModes?.modes ?? []}
            defaultMode={workflowModes?.defaultMode ?? null}
            onChange={onModesChange}
            disabled={!d.workflowId}
          />
        </div>
      </div>

      {/* 动态表单：由工作流暴露的 IO 驱动，端口 Handle 与测试节点一致骑跨卡边
       *  `showOutputs={false}` — 在画布场景下，workflow
       *  节点是叶节点（生成图片/视频），不需要被 wire 到下一个节点；显示
       *  右侧紫色 images 输出 Handle 会让用户误以为是漏出的 bug（"那个
       *  圆点不要"）。CreatePanel 路径仍走 `showOutputs={true}`，不影响。 */}
      <DynamicWorkflowForm
        io={workflowIO ?? undefined}
        loading={workflowIOLoading}
        values={d.workflowInputs ?? {}}
        onChange={onFormChange}
        compact
        showOutputs={false}
        workflowId={d.workflowId}
        seedModes={d.seedModes}
        onSeedModeChange={onSeedModeChange}
      />

      {/* outputs row — 收成单行 labelRow（label + 右侧 type chip）。
       *  与 inputs labelRow 视觉严格一致，端点 PortHandle 放最右（dir="out"，right:-6），
       *  style top:16 锁 label-row 中线（pt-1.5=6 + h-5/2=10 = 16px）。
       *  不再放 dim 占位控件行——outputs 是只读语义，labelRow 已经说清楚「● images | IMAGE」
       *  这是一个输出端口，多一行业务信息也只会冗余。 */}
      {outputs.length > 0 && (
        <div className="border-border-strong border-t">
          {outputs.map((output) => {
            /* conflict-aware — 与 inputs/outputs 同 group 去重。
             *  即使两个 outputs 同 label（如两个 IMAGE 都叫 "image"）也回退 name。 */
            const oLabel = ioLabel(output, [...inputs, ...outputs]);
            const oType = output.type;
            return (
              <div key={output.nodeId + ":" + output.name} className="relative">
                {/* 圆点几何位置上推 2px — 用户反馈
                 *  的 `top:16`（= labelRow 中线 y=16）虽然几何计算
                 *  完美（pt-1.5=6 + h-5/2=10 = 16），但实际渲染圆点仍视觉下
                 *  偏 1-2px（React Flow Handle 自身 transform + 小圆点抗锯齿
                 *  的「向下漂移」错觉）。top:14 把圆心放到 y=14，比 chip 中线
                 *  16 往上 2px，对抗视觉下偏。PortHandle 12×12 圆, 圆心 y=14
                 *  ⇒ 圆可视 y=8..20, 落在 labelRow y=6..26 范围内居中略偏上,
                 *  视觉与 chip 中线 16 重合。boxShadow: \"none\" 关掉默认下偏
                 *  阴影（4px y blur 4px 向下晕 8px 是主要下偏源）。 */}
                <PortHandle
                  id={output.ioKey}
                  dir="out"
                  type={oType ?? "*"}
                  style={{
                    right: -6,
                    top: 14,
                    transform: "translateY(-50%)",
                    boxShadow: "none",
                  }}
                />
                {/* 单行 labelRow — 与 inputs labelRow 镜像
                 *  顺序一致 = [label | typeChip]（label 在左、type 在右）。
                 *  `justify-end` 把整组贴紧 Card 右沿；端点 PortHandle 圆心锁
                 *  labelRow 中线（pt-1.5=6 + h-5/2=10=16px），与 typeChip 上下对齐。 */}
                <div className="flex h-5 items-center justify-end gap-1.5 px-[14px] pt-1.5">
                  <span
                    className="min-w-0 truncate text-[14px] font-semibold text-ink-bright"
                    style={{ fontFamily: "var(--font-sans)" }}
                    title={`IO 输出 · ${oLabel}${oType ? ` · ${oType}` : ""}`}
                  >
                    {oLabel}
                  </span>
                  <span
                    className="bg-border-strong text-ink-muted inline-flex shrink-0 items-center rounded-[3px] px-1.5 py-0.5 text-[12px] font-semibold"
                    style={{ fontFamily: "var(--font-sans)" }}
                  >
                    {typeDisplay(oType)}
                  </span>
                </div>
                {/* 下沿留 pb-2 让节点呼吸——与 inputs controlRow 末端的 pb-1.5 保持视觉等距 */}
                <div className="pb-2" />
              </div>
            );
          })}
        </div>
      )}

      {/* 生成按钮：全宽渐变，底部圆角贴合 Card（Card 无 overflow-hidden，故按钮自带 rounded-b） */}
      <button
        type="button"
        disabled={d.status === "running"}
        onClick={onGenerate}
        className="nodrag nopan flex h-[43px] w-full items-center justify-center gap-2 rounded-b-[14px] bg-linear-to-r from-primary to-accent text-[13px] font-bold text-white shadow-[0_4px_12px_rgba(124,92,252,0.35)] transition-opacity hover:opacity-95 disabled:opacity-40"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        {d.status === "running" ? "生成中…" : "▶ 用此工作流生成"}
      </button>
    </>
  );
}

export default React.memo(WorkflowNode);
