import type { Meta, StoryObj } from "@storybook/nextjs";
import { Bold, Italic, Underline } from "lucide-react";

import { Toggle } from "~/components/ui/toggle";

/**
 * 两轴候选清单从 `Toggle` 的 props 派生 —— 写法与理由与
 * `button.stories.tsx` 一致（`cva()` 的返回值运行时没有 `.variants`）。
 *
 * `pressed` 是**受控状态**、不是变体，所以它不列进 `argTypes.options`。
 */
type ToggleVariant = NonNullable<React.ComponentProps<typeof Toggle>["variant"]>;
type ToggleSize = NonNullable<React.ComponentProps<typeof Toggle>["size"]>;

const VARIANTS: Array<ToggleVariant> = ["default", "outline"];
const SIZES: Array<ToggleSize> = ["default", "sm", "lg"];

const meta = {
  args: { children: "粗体" },
  argTypes: {
    size: { control: "select", options: SIZES },
    variant: { control: "select", options: VARIANTS },
  },
  component: Toggle,
  title: "UI/Toggle",
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
