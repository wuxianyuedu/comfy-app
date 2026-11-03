import type { Meta, StoryObj } from "@storybook/nextjs";

import { WorkflowSourceFilterChip } from "~/components/studio/project-canvas/WorkflowSourceFilterChip";

/**
 * 画布工作流节点上的「来源筛选」chip（全部 / 本机 / 在线，纯 props）。
 * 触发器圆点与文字色按当前值分叉（本机 `status-online`、其余 `primary-strong`）；
 * 浮层壳与选项行走 `ui/option-list-popover`（规范 16 §16.2.4.14），story 只摆真组件。
 */
/* SAFETY: 类型断言已复核 */
const OPTIONS = ["all", "local", "online"] as const;

const meta = {
  title: "Studio/WorkflowSourceFilterChip",
  component: WorkflowSourceFilterChip,
  args: { value: "all", onChange: () => undefined },
  argTypes: {
    value: { control: { type: "select" }, options: OPTIONS },
  },
} satisfies Meta<typeof WorkflowSourceFilterChip>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 三档并排：圆点与文字的配色分叉。 */
export const AllValues: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      {OPTIONS.map((value) => (
        <div className="flex flex-col items-start gap-1.5" key={value}>
          <span className="text-ink-muted font-mono text-[11px]">value = {value}</span>
          <WorkflowSourceFilterChip onChange={() => undefined} value={value} />
        </div>
      ))}
    </div>
  ),
};

/** 「本机」：圆点与文字都换到 `status-online`（与其余两档不是同一套配色）。 */
export const Local: Story = {
  args: { value: "local" },
};

/**
 * 留出浮层展开的空间：下拉会挂在下达下方，容器不给高度的话它会盖到邻居上。
 * 这一档不是状态，是**摆放约定** —— 与另外几份 chip 的 story 同款。
 */
export const RoomToOpen: Story = {
  render: () => (
    <div className="flex min-h-64 items-start">
      <WorkflowSourceFilterChip onChange={() => undefined} value="all" />
    </div>
  ),
};
