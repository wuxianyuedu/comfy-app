import type { Meta, StoryObj } from "@storybook/nextjs";

import {
  WorkflowNodeActionButton,
  WorkflowNodeCardShell,
  WorkflowNodeDivider,
  WorkflowNodeHeader,
  WorkflowNodeOutputsRow,
  WorkflowNodePill,
  WorkflowStaticChip,
} from "~/components/studio/workflow-form/WorkflowNodeParts";
import type { WorkflowIOEntry } from "~/lib/workflow/workflow-io-types";

/**
 * 工作流节点卡片的共享视觉部件 —— **唯一事实源**。
 *
 * 这两个组件必须从同一份部件取卡片外观：
 *   · 项目画布（`project-canvas/WorkflowNode`）；
 *   · 工作流库的画布节点预览（`workflow-library/WorkflowCanvasNodePreview`）。
 *
 * 此前工作流库手搓了一份「画布样式预览」，宽度（340 vs 380）、状态胶囊、outputs 行、
 * 按钮圆角**全部漂移**。用户诉求是「工作流库里的节点展示与项目画布完全一致」——
 * 所以这组 story 要看的是**同一批部件拼出来的卡片**，而不是某一处的实现。
 *
 * 这里有三个刻意分叉的地方值得一提（它们是部件级 props，不是两处各写一遍）：
 *   · 头部右侧胶囊：画布放**节点序号**，库内放**运行状态**（由调用处给 `right`）；
 *   · outputs 行：库内**没有 React Flow 上下文**，`renderHandle` 不传时只渲染
 *     label + 类型 chip（端点几何只在画布那侧维护）；
 *   · 类型 chip 走 `typeDisplay()`，`*` 是「没声明类型」的出口，不是空串。
 */
const entry = (
  over: Partial<WorkflowIOEntry> & { ioKey: string },
): WorkflowIOEntry & { ioKey: string } => ({
  direction: "output",
  kind: "output",
  nodeId: "9",
  name: "images",
  label: "输出图像",
  type: "IMAGE",
  ...over,
});

const OUTPUTS = [
  entry({ ioKey: "9:images", label: "输出图像", type: "IMAGE" }),
  entry({
    ioKey: "12:video",
    nodeId: "12",
    name: "video",
    label: "视频片段",
    type: "VIDEO",
  }),
  entry({
    ioKey: "7:raw",
    nodeId: "7",
    name: "raw",
    label: "未声明类型的输出",
    type: undefined,
  }),
];

/**
 * 拼一张完整的节点卡片 —— 部件本身是「积木」，单摆每一块都看不出宽度 380 /
 * 圆角 14 / 底部按钮贴合圆角这几条**整体**约定。所以这里给两档「怎么拼」。
 */
function NodeCardSample({
  title,
  pill,
  actionLabel,
  withHandle = false,
}: {
  title: string;
  pill: React.ReactNode;
  actionLabel: string;
  withHandle?: boolean;
}) {
  return (
    <WorkflowNodeCardShell>
      <WorkflowNodeHeader
        title={title}
        titleTitle={`工作流 · ${title}`}
        right={pill}
      />
      <WorkflowNodeDivider />
      <div className="pt-1.5">
        {OUTPUTS.map((output) => (
          <WorkflowNodeOutputsRow
            key={output.ioKey}
            output={output}
            inputs={[]}
            outputs={OUTPUTS}
            renderHandle={
              withHandle
                ? ({ id, type }) => (
                    <span
                      key={id}
                      className="bg-primary absolute top-1/2 right-0 size-2.5 translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white/20"
                      title={`输出端点 · ${type}`}
                    />
                  )
                : undefined
            }
          />
        ))}
      </div>
      <WorkflowNodeDivider />
      <WorkflowNodeActionButton label={actionLabel} />
    </WorkflowNodeCardShell>
  );
}

const meta = {
  title: "Studio/WorkflowNodeParts",
  component: NodeCardSample,
  args: {
    title: "角色一致性 · 三视图",
    pill: <span className="text-ink-muted text-[10px]">节点 3</span>,
    actionLabel: "运行工作流",
    withHandle: false,
  },
} satisfies Meta<typeof NodeCardSample>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 库内形态：头部胶囊放**运行状态**，不渲染端点（没有 React Flow 上下文）。 */
export const LibraryPreview: Story = {
  args: {
    pill: <span className="text-ink-muted text-[10px]">已发布 · 27 节点</span>,
    actionLabel: "使用此工作流",
  },
};

/**
 * 画布形态：头部胶囊放**节点序号**，`renderHandle` 由画布传入（端点几何在那边维护）。
 * 与上一档是同一批部件 —— 这正是「两处不许复刻」这条约定的样子。
 */
export const CanvasNode: Story = {
  args: {
    pill: <span className="text-ink-muted text-[10px]">#3</span>,
    actionLabel: "运行工作流",
    withHandle: true,
  },
};

/** 两档并排：同一批部件、只差调用处给的两处 props。 */
export const BothSites: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-start gap-8">
      <div className="flex flex-col gap-1.5">
        <span className="text-ink-muted font-mono text-[11px]">
          工作流库（无端点 · 状态胶囊）
        </span>
        <NodeCardSample
          {...args}
          title="角色一致性 · 三视图"
          pill={
            <span className="text-ink-muted text-[10px]">已发布 · 27 节点</span>
          }
          actionLabel="使用此工作流"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-ink-muted font-mono text-[11px]">
          项目画布（有端点 · 序号胶囊）
        </span>
        <NodeCardSample
          {...args}
          title="角色一致性 · 三视图"
          pill={<span className="text-ink-muted text-[10px]">#3</span>}
          actionLabel="运行工作流"
          withHandle
        />
      </div>
    </div>
  ),
};

/**
 * 散件总览：头部 / 分隔线 / 胶囊 / 只读 chip / 底部按钮各自单摆一份。
 *
 * 这些件的差别在小处（胶囊 `h-5 r11`、chip `h-6 r8` 紫描边），单看某一件时
 * 「规格对不对」很难判断；摆在一屏里才看得出它们的**尺寸梯度**是有意的。
 */
export const IndividualParts: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="text-ink-muted font-mono text-[11px]">
          头部 + 胶囊
        </span>
        <div className="border-border-strong bg-card w-95 rounded-[14px] border">
          <WorkflowNodeHeader
            title="首帧 → 逐镜生成"
            right={
              <WorkflowNodePill title="本机工作流">
                <span className="bg-status-online size-1.5 rounded-full" />
                <span className="text-ink-bright text-[10px]">本机</span>
              </WorkflowNodePill>
            }
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-ink-muted font-mono text-[11px]">只读 chip</span>
        <div className="flex items-center gap-2">
          <WorkflowStaticChip>SDXL</WorkflowStaticChip>
          <WorkflowStaticChip>27 节点</WorkflowStaticChip>
          <WorkflowStaticChip title="没有任务类型标记">
            未分类
          </WorkflowStaticChip>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-ink-muted font-mono text-[11px]">
          底部按钮（常态 / 禁用）
        </span>
        <div className="w-95 overflow-hidden rounded-[14px] border">
          <WorkflowNodeActionButton label="运行工作流" />
        </div>
        <div className="w-95 overflow-hidden rounded-[14px] border">
          <WorkflowNodeActionButton
            label="运行工作流"
            disabled
            hint="工作流还没解析出参数"
          />
        </div>
      </div>
    </div>
  ),
};
