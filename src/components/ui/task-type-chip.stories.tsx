import type { Meta, StoryObj } from "@storybook/nextjs";

import { TaskTypeChip } from "~/components/ui/task-type-chip";
import { VALID_TASK_TYPE_CODES } from "~/lib/workflow/workflow-types";

/**
 * 三档类型色**刻意保留 Tailwind 字面量**（violet / sky / amber，规范 03
 * §3.6.1 的类型色例外）：它们表达「这是哪一种媒体」，是分类锚点而不是表面
 * 色 —— 改品牌色对它不生效是有意的。
 *
 * 候选值不手写：`VALID_TASK_TYPE_CODES` 是 `~/lib/workflow/workflow-types`
 * 导出的**唯一一份**类型码集合，这里直接铺它 —— 新增一类媒体这一屏自动跟上
 * （从 props 派生不出这张表，它就是「枚举只写一份」的那一份）。
 */
const CODES = [...VALID_TASK_TYPE_CODES];

const meta = {
  title: "UI/TaskTypeChip",
  component: TaskTypeChip,
  args: { taskType: "image" },
  argTypes: {
    taskType: { control: "select", options: CODES },
  },
} satisfies Meta<typeof TaskTypeChip>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** 全部类型 + 两个兜底（空串 / 认不出的码 —— 都落 image 档的默认色）。 */
export const AllTypes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      {[...CODES, "", "not-a-type"].map((taskType) => (
        <TaskTypeChip key={taskType} taskType={taskType} />
      ))}
    </div>
  ),
};

/** 密集列表行里的形态：与 `list-badge` 并排时两者圆角 / 高度 / 边框处理一致。 */
export const InListRow: Story = {
  render: () => (
    <div className="flex w-72 items-center gap-1.5 overflow-hidden py-1.5 text-xs">
      <span className="truncate">角色一致性工作流</span>
      <TaskTypeChip taskType="image" />
      <TaskTypeChip taskType="video" />
      <TaskTypeChip taskType="audio" />
    </div>
  ),
};
