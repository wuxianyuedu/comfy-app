import type { Meta, StoryObj } from "@storybook/nextjs";

import { ParamOwnerTag } from "~/components/studio/workflow-library/ParamOwnerTag";

/**
 * 宿主卡片里参数行尾部的只读徽标 —— 纯 props，入参只有一个可选的 `label`。
 *
 * 它与左侧的对外参数卡片互为两端：卡片说「这个对外参数由哪些端口组成」，
 * 徽标说「这一行属于哪个对外参数」。**同一份落点事实只在表单行这侧标一次**，
 * 卡片不再重复画线 —— 所以这条 story 的重点是「没有对外参数落到这一行时它不渲染」，
 * 而不是「徽标的样子」。绝大多数行都属于前一种情况，那一档不摆出来的话，
 * 会让人以为每个参数行都会挂一个徽标。
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
 * 没有归属：`label` 是 `undefined` 时**整件不渲染**（返回 `null`）。
 *
 * 所以这一档画布上应当**什么都没有** —— 下面那行小字是 story 自己加的注解，
 * 它右边的空列就是 `ParamOwnerTag` 的全部输出。这不是「漏了什么」，
 * 正是它与「每个参数行都挂一个徽标」那条误读的分界。
 */
export const NoOwnerRendersNothing: Story = {
  args: { label: undefined },
  render: (args) => (
    <div className="flex items-center gap-3">
      <span className="text-ink-muted font-mono text-[11px]">
        label = undefined →
      </span>
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
