import type { Meta, StoryObj } from "@storybook/nextjs";

import {
  NodeChip,
  StatusBadge,
  StatusDot,
} from "~/components/studio/project-canvas/CanvasNode/CanvasNodePrimitives";
import {
  NODE_META,
  STATUS_BADGE_KEY,
  STATUS_LABEL,
  type NodeKind,
} from "~/lib/project-canvas/canvas-types";

/**
 * 画布节点的小型共享 UI 原语（`CanvasNodePrimitives`）—— 三件纯 props 的件，
 * 由节点头部与结果卡头部**共用**。
 *
 * 为什么合成一份 story 而不是三份：这三件的共同契约是「同一份状态 / 类型口径
 * 全库只有一处」——
 *   · `StatusDot` / `StatusBadge` 都按 `CanvasNodeData["status"]` 的**四档**穷举；
 *   · `NodeChip` 按 `NODE_META[kind]` 取色与类型字符。
 * 所以 story 里逐档**从 `canvas-types` 那份常量派生**（`STATUS_LABEL` /
 * `NODE_META`），不手抄「待开始 / 生成中…」那几句 —— 手抄就正好把这条契约
 * 在 story 里反过来写一遍，字面量漂了而画布看着正常。
 *
 * 一处值得看的历史：`StatusBadge` 此前**另写四档字面量配色**，改状态色要点两遍名。
 * 现在它走 `ui/status-badge` 的同一份「状态 → 语义 token」映射（规范 16 §16.2.4.5），
 * 所以下面这两件并排时**颜色口径是同一个**。
 */
const STATUSES = Object.keys(STATUS_LABEL) as Array<keyof typeof STATUS_LABEL>;
const KINDS = Object.keys(NODE_META) as NodeKind[];

const meta = {
  title: "Studio/CanvasNodePrimitives",
  component: StatusBadge,
  args: { status: "running" },
  argTypes: {
    status: {
      control: { type: "select" },
      options: STATUSES,
      description: "画布节点的生命周期状态（canvas-types 的四档）",
    },
  },
} satisfies Meta<typeof StatusBadge>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 状态徽标四档：文案与状态键都从 `canvas-types` 取。 */
export const StatusBadges: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      {STATUSES.map((status) => (
        <div key={status} className="flex items-center gap-2">
          <span className="text-ink-muted font-mono text-[11px]">
            {status} → {STATUS_BADGE_KEY[status]}
          </span>
          <StatusBadge status={status} />
        </div>
      ))}
    </div>
  ),
};

/**
 * 状态圆点四档：与徽标**同源**的四档配色（`running` / `done` / `error` /
 * 其余归 idle）。徽标与圆点并排，能同时看到「文案那一路」与「圆点那一路」。
 */
export const StatusDots: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-4">
      {STATUSES.map((status) => (
        <div key={status} className="flex items-center gap-2">
          <StatusDot status={status} />
          <span className="text-ink-soft text-xs">{STATUS_LABEL[status]}</span>
        </div>
      ))}
    </div>
  ),
};

/** 类型章两档尺寸：`md`（节点头部）与 `sm`（结果卡 / 紧凑行）。 */
export const NodeChips: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-ink-muted font-mono text-[11px]">size = md</span>
        {KINDS.map((kind) => (
          <NodeChip key={kind} kind={kind} name={NODE_META[kind].label} />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-ink-muted font-mono text-[11px]">size = sm</span>
        {KINDS.map((kind) => (
          <NodeChip
            key={kind}
            kind={kind}
            name={NODE_META[kind].label}
            size="sm"
          />
        ))}
      </div>
    </div>
  ),
};

/**
 * 三件合成一条节点头部：真机上它们就是这么排的（类型章在左、状态徽标在右）。
 * 单摆各自的 story 都「对」，而「组合起来会不会挤」只有这一档看得出来。
 */
export const NodeHeaderComposition: Story = {
  render: () => (
    <div className="bg-canvas-deep border-border-strong w-72 rounded-xl border p-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <NodeChip kind="image" name="海边灯塔 · 黄昏" />
        </div>
        <StatusDot status="running" />
        <StatusBadge status="running" />
      </div>
    </div>
  ),
};
