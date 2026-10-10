import type { Meta, StoryObj } from "@storybook/nextjs";

import { SelectChip } from "~/components/ui/select-chip";

/**
 * `ui/select-chip` 是「一排里选一个」的 chip。
 *
 * 形态清单从 `SelectChipProps` 的 props 派生（`cva()` 的返回值运行时没有
 * `.variants`，写法与 `button.stories.tsx` / `badge.stories.tsx` 一致）。
 *
 * **最值得看的一根轴是「选中 × 悬停」**：这是本件存在的理由 —— `Button
 * variant="outline"` 自带 `hover:text-foreground`，收口前的选中分支没钉住
 * 悬停值，于是划到已选中的 chip 上字色翻白。storybook 里把鼠标移到
 * `Selected` 那一枚上就能看出它**不变**（ISSUE #1423）。
 */
type ChipShape = NonNullable<React.ComponentProps<typeof SelectChip>["shape"]>;

const SHAPES: ChipShape[] = ["pill", "segment", "compact", "dashed"];

const meta = {
  title: "UI/SelectChip",
  component: SelectChip,
  args: { children: "文生图", selected: false, shape: "pill" },
  argTypes: {
    shape: { control: "select", options: SHAPES },
    selected: { control: "boolean" },
  },
} satisfies Meta<typeof SelectChip>;

export default meta;

type Story = StoryObj<typeof meta>;

/* `args` 显式写一遍（而不是只挂在 `meta.args` 上）：a11y 那一档
 *（`tests/a11y-axe-stories.test.ts`）按 **`story.args`** 渲染，读不到 `meta.args`
 * ——只挂 meta 的故事会以**裸组件**（无 children）被测出来，`button-name` 当场命中。
 * 这不是那一档的缺陷，是「故事自己得站得住」：把内容写在 args 上，
 * 顺带让控件面板里也看得见它的初值。 */
export const Default: Story = {
  args: { children: "文生图" },
};

/** 四种形态各自代表一种落点：胶囊筛选 / 方角分段 / 紧凑编辑器 / 虚线动作。 */
export const Shapes: Story = {
  args: { children: "形状" },
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      {SHAPES.map((shape) => (
        <SelectChip key={shape} {...args} shape={shape}>
          {shape}
        </SelectChip>
      ))}
    </div>
  ),
};

/**
 * 「选中 × 悬停」两两对照 —— 本件的核心判据在画面上长这样：
 * 悬停**已选中**的那一枚，它应该与常态**逐像素相同**；悬停未选中的那一枚，
 * 它只是底色变浅，绝不能长得像选中。
 */
export const SelectedVsHover: Story = {
  args: { children: "已选中" },
  render: () => (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-muted-foreground mb-2 text-xs">常态</p>
        <div className="flex flex-wrap items-center gap-2">
          <SelectChip selected>已选中</SelectChip>
          <SelectChip>未选中</SelectChip>
        </div>
      </div>
      <div>
        <p className="text-muted-foreground mb-2 text-xs">
          把鼠标移上来：已选中的**不应当**变样（这正是 ISSUE #1423
          修掉的那件事）
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <SelectChip selected>已选中（悬停试试）</SelectChip>
          <SelectChip>未选中（悬停试试）</SelectChip>
        </div>
      </div>
    </div>
  ),
};

/** 一排里选一个 —— 语义是 `radiogroup` + `radio`，不是 `aria-pressed`。 */
export const RadioGroupUsage: Story = {
  args: { children: "gpt-image-1" },
  render: (args) => (
    <div
      role="radiogroup"
      aria-label="选择远端模型"
      className="flex flex-wrap items-center gap-2"
    >
      {["gpt-image-1", "flux-pro-ultra", "seedream-4"].map((name, i) => (
        <SelectChip key={name} {...args} selected={i === 0}>
          {name}
        </SelectChip>
      ))}
    </div>
  ),
};

/** 虚线档是同一排里的**动作**（＋ 添加），不是选中态。 */
export const DashedAction: Story = {
  args: { children: "文生图" },
  render: (args) => (
    <div className="flex flex-wrap items-center gap-2">
      <SelectChip {...args} selected>
        文生图
      </SelectChip>
      <SelectChip {...args} shape="dashed" selected={false}>
        ＋ 添加模式
      </SelectChip>
    </div>
  ),
};

/** 禁用档：已加入的预制参数用它表达「已经有它了」，而不是靠灰化。 */
export const Disabled: Story = {
  args: { children: "提示词" },
  render: (args) => (
    <div className="flex flex-wrap items-center gap-2">
      <SelectChip {...args} shape="compact" selected disabled>
        ✓ 提示词
      </SelectChip>
      <SelectChip {...args} shape="compact">
        ＋ 宽高比
      </SelectChip>
    </div>
  ),
};
