import type { Meta, StoryObj } from "@storybook/nextjs";
import { Bold, Italic, Underline } from "lucide-react";

import { Toggle } from "~/components/ui/toggle";

/**
 * 两轴候选清单从 `Toggle` 的 props 派生 —— 写法与理由与
 * `button.stories.tsx` 一致（`cva()` 的返回值运行时没有 `.variants`）。
 *
 * `pressed` 是**受控状态**、不是变体，所以它不列进 `argTypes.options`。
 */
type ToggleVariant = NonNullable<
  React.ComponentProps<typeof Toggle>["variant"]
>;
type ToggleSize = NonNullable<React.ComponentProps<typeof Toggle>["size"]>;

const VARIANTS: ToggleVariant[] = ["default", "outline"];
const SIZES: ToggleSize[] = ["default", "sm", "lg"];

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
        <div key={variant} className="flex items-center gap-3">
          {SIZES.map((size) => (
            <Toggle key={size} {...args} variant={variant} size={size}>
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
      <Toggle pressed aria-label="斜体">
        <Italic />
      </Toggle>
      <Toggle disabled aria-label="下划线">
        <Underline />
      </Toggle>
    </div>
  ),
};

/** 一组互相独立的开关（不是单选）—— 真实落点是富文本工具栏那排图标。 */
export const Toolbar: Story = {
  render: () => (
    <div className="border-border inline-flex items-center gap-1 rounded-lg border p-1">
      <Toggle size="sm" pressed aria-label="加粗">
        <Bold />
      </Toggle>
      <Toggle size="sm" aria-label="斜体">
        <Italic />
      </Toggle>
      <Toggle size="sm" variant="outline" aria-label="下划线">
        <Underline />
      </Toggle>
    </div>
  ),
};
