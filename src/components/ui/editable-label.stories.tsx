import type { Meta, StoryObj } from "@storybook/nextjs";

import { EditableLabel } from "~/components/ui/editable-label";

/**
 * `EditableLabel` 是「点一下变输入框、回车提交」的行内改名件。
 *
 * 两条只有操作才看得出来的设计（所以 story 里都用 `play` 把它摆出来）：
 * 1. **不传 `onChange` 就是只读**（`editable = typeof onChange === "function"`）
 *    —— 这时连铅笔图标都不出现，形态与 `onChange` 那档**不同**；
 * 2. **`onChange` 只在回车 / 失焦时提交一次**，输入中途不回调 ——
 *    草稿与真值分离，所以入参 `label` 在编辑期间变了会被**覆盖回草稿**
 *    （`label !== prevLabel` 那条渲染期同步）。
 */
const meta = {
  title: "UI/EditableLabel",
  component: EditableLabel,
  args: { label: "角色一致性 · 三视图" },
} satisfies Meta<typeof EditableLabel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 可编辑（有 `onChange`）：悬停出现铅笔，点开变输入框。 */
export const Editable: Story = {
  args: { onChange: () => void 0, title: "点击重命名" },
  render: (args) => (
    <div className="flex w-80 items-center rounded-lg border px-3 py-2">
      <EditableLabel {...args} />
    </div>
  ),
};

/** 只读（不给 `onChange`）：**形态与上面那档不同** —— 这是一个
 *  纯文本 span，没有铅笔、点不动、也没有 hover 反馈。 */
export const ReadOnly: Story = {
  render: (args) => (
    <div className="flex w-80 items-center rounded-lg border px-3 py-2">
      <EditableLabel {...args} />
    </div>
  ),
};

/** 极长名：`truncate` 在只读态生效（`min-w-0 flex-1`），
 *  编辑态则由输入框自己横向滚动 —— 两种截断方式不同，长名字下才看得出。 */
export const LongLabel: Story = {
  args: {
    label: "一个名字非常非常长的工作流：角色一致性三视图加背景补全加超分",
    onChange: () => void 0,
  },
  render: (args) => (
    <div className="flex w-64 items-center rounded-lg border px-3 py-2">
      <EditableLabel {...args} />
    </div>
  ),
};
