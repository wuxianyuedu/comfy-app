import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { SelectMenu } from "~/components/ui/select-menu";

/** `ui/select-menu` 的浮层自适应（ISSUE #4531）：参考图装载预设弹层的部件 COMBO
 * 用紧凑触发器（`text-3xs h-7 w-full`、下限 140px），选项里最长的
 * 「scale shorter dimension」曾在死宽里被截断（下拉菜单内容看不全）。
 * 自适应开启后浮层按最长选项加宽（上限 720px），这里用同一组选项复现该场景。 */
const RESIZE_TYPE_CHOICES = [
  "scale dimensions",
  "scale by multiplier",
  "scale longer dimension",
  "scale shorter dimension",
  "scale width",
  "scale height",
  "scale total pixels",
  "match size",
  "scale to multiple",
];

const comboArgs = {
  "aria-label": "resize_type",
  className: "text-3xs h-7 w-full",
  labels: Object.fromEntries(RESIZE_TYPE_CHOICES.map((choice) => [choice, choice])),
  options: RESIZE_TYPE_CHOICES,
  popoverMinWidth: 140,
  value: "scale total pixels",
  onChange: () => undefined,
} satisfies React.ComponentProps<typeof SelectMenu>;

/** 演示组件：受控值单独持一份（story 的 args 里 onChange 是占位）。 */
function ReferenceLoaderWidgetComboDemo() {
  const [value, setValue] = useState(comboArgs.value);
  return (
    <div className="w-64 p-4">
      <SelectMenu {...comboArgs} onChange={setValue} value={value} />
    </div>
  );
}

const meta = {
  title: "UI/SelectMenu",
  component: SelectMenu,
} satisfies Meta<typeof SelectMenu>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ReferenceLoaderWidgetCombo: Story = {
  args: comboArgs,
  render: () => <ReferenceLoaderWidgetComboDemo />,
};
