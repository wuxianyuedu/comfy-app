import type { Meta, StoryObj } from "@storybook/nextjs";

import { ParamOwnerTag } from "~/components/studio/workflow-library/ParamOwnerTag";

/**
 * 参数行尾部只读徽标：`label` 标出该行属于哪个对外参数，与左侧卡片互为两端，
 * 落点事实只在表单行标一次。这条 story 的重点是「没有归属时不渲染」。
 */
const meta = {
  title: "Studio/ParamOwnerTag",
  component: ParamOwnerTag,
  args: { label: "提示词" },
} satisfies Meta<typeof ParamOwnerTag>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 有归属：徽标标出对外参数名（`title` 里是完整的落点说明）。 */
export const Default: Story = {};

/**
 * 没有归属：`label` 为 `undefined` 时返回 `null`，画布上应当什么都没有；
 * 下面那行小字是 story 自己的注解，右列空着不是漏渲染。
 */
export const NoOwnerRendersNothing: Story = {
  args: { label: undefined },
  render: (args) => (
    <div className="flex items-center gap-3">
      <span className="text-ink-muted font-mono text-[11px]">label = undefined →</span>
      <span className="border-border text-ink-faint rounded border border-dashed px-3 py-1 text-[11px]">
        <ParamOwnerTag {...args} />
      </span>
    </div>
  ),
};

/** 长名字：徽标不换行、不撑开行 —— 它是行尾的附属件，宽度由内容封顶。 */
export const LongLabel: Story = {
  args: { label: "视频生成 · 首帧参考图（多选）" },
  render: (args) => (
    <div className="flex w-72 items-center justify-between gap-2 border-b py-1.5">
      <span className="text-ink-soft truncate text-xs">首帧参考图</span>
      <ParamOwnerTag {...args} />
    </div>
  ),
};
