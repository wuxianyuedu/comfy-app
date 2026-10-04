import type { Meta, StoryObj } from "@storybook/nextjs";

import { WorkflowSourceFilterChip } from "~/components/studio/project-canvas/WorkflowSourceFilterChip";

/**
 * 画布工作流节点上的「来源筛选」chip（全部 / 本机 / 在线）。
 *
 * 纯 props（`value` / `onChange`），但它有一件**只在两档并排时才看得见**的东西：
 * 触发器的**圆点与文字色按当前值分叉**（本机走 `status-online`、其余走
 * `primary-strong`）——「全部」与「在线」共用同一套配色，而语义上它们不是同一件事
 * （一个是不筛，一个是筛在线）。所以下面把三档都摆出来，这处口径要改时能一眼看到
 * 自己在改哪几档。
 *
 * 浮层壳与选项行走 `ui/option-list-popover`（规范 16 §16.2.4.14）—— 本目录四个
 * chip 此前各写一遍这份壳，所以 story 里不摆自定义浮层，只摆真组件。
 */
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
        <div key={value} className="flex flex-col items-start gap-1.5">
          <span className="text-ink-muted font-mono text-[11px]">
            value = {value}
          </span>
          <WorkflowSourceFilterChip value={value} onChange={() => undefined} />
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
      <WorkflowSourceFilterChip value="all" onChange={() => undefined} />
    </div>
  ),
};
