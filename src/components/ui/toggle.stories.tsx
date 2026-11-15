import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Bold, Italic, Underline } from "lucide-react";

import { Toggle } from "~/components/ui/toggle";

/**
 * 两轴候选清单从 `Toggle` 的 props 派生，写法与理由见 `button.stories.tsx`（`cva()` 返回值运行时没有 `.variants`）。`pressed` 是受控状态、不是变体，故不列进 `argTypes.options`。
 */
type ToggleVariant = NonNullable<React.ComponentProps<typeof Toggle>["variant"]>;
type ToggleSize = NonNullable<React.ComponentProps<typeof Toggle>["size"]>;

const VARIANTS: Array<ToggleVariant> = ["default", "outline", "chip"];
const SIZES: Array<ToggleSize> = ["default", "sm", "lg"];

const meta = {
  title: "UI/Toggle",
  component: Toggle,
  args: { children: "粗体" },
  argTypes: {
    variant: { control: "select", options: VARIANTS },
    size: { control: "select", options: SIZES },
  },
} satisfies Meta<typeof Toggle>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** 两轴铺开：`default` 无边框 / `outline` 带描边；三档尺寸（`min-w-*` 让
 *  纯图标按钮也是方的）。 */
export const VariantsAndSizes: Story = {
  render: (args) => (
    <div className="flex flex-col gap-4">
      {VARIANTS.map((variant) => (
        <div className="flex items-center gap-3" key={variant}>
          {SIZES.map((size) => (
            <Toggle key={size} {...args} size={size} variant={variant}>
              <Bold />
              {size}
            </Toggle>
          ))}
        </div>
      ))}
    </div>
  ),
};

/** 三个状态一眼对比：未按下 / 按下（`data-pressed` 给 `bg-muted`）/ 禁用。 */
export const States: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Toggle aria-label="加粗">
        <Bold />
      </Toggle>
      <Toggle aria-label="斜体" pressed>
        <Italic />
      </Toggle>
      <Toggle aria-label="下划线" disabled>
        <Underline />
      </Toggle>
    </div>
  ),
};

/** 一组互相独立的开关（不是单选）—— 真实落点是富文本工具栏那排图标。 */
export const Toolbar: Story = {
  render: () => (
    <div className="border-border inline-flex items-center gap-1 rounded-lg border p-1">
      <Toggle aria-label="加粗" pressed size="sm">
        <Bold />
      </Toggle>
      <Toggle aria-label="斜体" size="sm">
        <Italic />
      </Toggle>
      <Toggle aria-label="下划线" size="sm" variant="outline">
        <Underline />
      </Toggle>
    </div>
  ),
};

/** chip 多选（#3577）：选中态用品牌色描边 + 15% 品牌底 —— 暗色主题下与未选
 *  拉开一档（default/outline 的选中态只是 bg-muted，同灰看不出按下没有）。
 *  真实落点是模型弹窗的输入 / 输出类型与能力多选。 */
export const Chips: Story = {
  render: () => (
    <div className="flex flex-wrap gap-1.5">
      {(["文本", "图片", "视频"] as const).map((label, i) => (
        <Toggle aria-label={label} key={label} pressed={i < 2} size="sm" variant="chip">
          {label}
        </Toggle>
      ))}
    </div>
  ),
};
