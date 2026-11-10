import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { WorkflowModelFilterChip } from "~/components/studio/project-canvas/WorkflowModelFilterChip";

/**
 * 画布工作流节点上的「模型标签筛选」chip（纯 props）。
 * `tags` 的 `count` 只用于显示，筛选键仍是标签名；两档空态刻意分开：
 * 标签库为空给出口，已选中则直接显示标签名（节点上那格只有几十像素）。
 */
const TAGS = [
  { id: "t1", name: "SDXL", count: 12 },
  { id: "t2", name: "Flux", count: 7 },
  { id: "t3", name: "Wan2.2", count: 3 },
];

const meta = {
  title: "Studio/WorkflowModelFilterChip",
  component: WorkflowModelFilterChip,
  args: { value: "all", tags: TAGS, onChange: () => undefined },
  argTypes: {
    value: { control: { type: "text" } },
    tags: { control: { type: "object" } },
  },
} satisfies Meta<typeof WorkflowModelFilterChip>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 未筛选：触发器走「全部模型」，圆点用亮色 `bg-accent`。 */
export const AllModels: Story = {};

/** 已筛选某一档：触发器显示标签名，圆点换成 `bg-accent-soft`。 */
export const Filtered: Story = {
  args: { value: "Flux" },
};

/** 标签库为空：选项列表走空提示（带「去哪儿加」的出口，不是一个光秃秃的空框）。 */
export const EmptyTagLibrary: Story = {
  args: { tags: [] },
  render: (args) => (
    <div className="flex min-h-40 items-start">
      <WorkflowModelFilterChip {...args} />
    </div>
  ),
};

/** 计数是选项行右侧的附属信息，与筛选值无关 —— 三档并排能看清这件事。 */
export const WithCounts: Story = {
  render: () => (
    <div className="flex min-h-64 items-start">
      <WorkflowModelFilterChip onChange={() => undefined} tags={TAGS} value="all" />
    </div>
  ),
};
