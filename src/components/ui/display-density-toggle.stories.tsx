import type { Meta, StoryObj } from "@storybook/nextjs";

import { DisplayDensityToggle } from "~/components/ui/display-density-toggle";

/**
 * `ui/display-density-toggle` 是「网格 / 列表」两档的图标密度切换。
 *
 * 它抽出来之前全库有**三处逐字相同**的手搓实现（画布历史抽屉 / 画布素材
 * 抽屉 / 素材库）—— 连 `Hint` 文案与三元里的 `bg-surface-2` 都一样。
 * 三份坏在同一个看不见的接缝：选中档只给底色、**没钉字色悬停**，于是
 * `ghost` 的 `hover:text-foreground` 会在划过已选中那枚时把字色翻掉。
 *
 * **最值得看的一根轴是「选中 × 悬停」**：把鼠标移到**已选中**的那一枚上，
 * 它应当与常态逐像素相同（ISSUE #1925）。
 */
const meta = {
  title: "UI/DisplayDensityToggle",
  component: DisplayDensityToggle,
  args: { value: "grid", onChange: () => undefined },
  argTypes: {
    value: { control: "select", options: ["grid", "list"] },
  },
} satisfies Meta<typeof DisplayDensityToggle>;

export default meta;

type Story = StoryObj<typeof meta>;

/* `args` 显式写一遍（`onChange` 也要给）：a11y 那一档按 `story.args` 渲染，
 * 读不到 `meta.args` —— 只挂 meta 的故事会以裸组件被测出来。 */
export const Default: Story = {
  args: { value: "grid", onChange: () => undefined },
};

/** 两档对照 —— 选中态由 `aria-checked` 一处驱动（不是 `aria-pressed` 开关）。 */
export const BothStates: Story = {
  args: { value: "grid", onChange: () => undefined },
  render: (args) => (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-muted-foreground mb-2 text-xs">
          网格档选中（把鼠标移到左边那枚上：它**不应当**变样）
        </p>
        <DisplayDensityToggle {...args} value="grid" />
      </div>
      <div>
        <p className="text-muted-foreground mb-2 text-xs">列表档选中</p>
        <DisplayDensityToggle {...args} value="list" />
      </div>
    </div>
  ),
};

/** 与它并列时的样子：一排工具条尾部的那一格。 */
export const InToolbar: Story = {
  args: { value: "grid", onChange: () => undefined },
  render: (args) => (
    <div className="border-border bg-panel flex items-center gap-2 rounded-lg border px-3 py-2">
      <span className="text-ink text-xs">历史记录</span>
      <span className="text-ink-fainter text-2xs">12 条</span>
      <DisplayDensityToggle {...args} className="ml-auto" />
    </div>
  ),
};
