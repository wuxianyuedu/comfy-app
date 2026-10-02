import type { Meta, StoryObj } from "@storybook/nextjs";

import { Spinner } from "~/components/ui/spinner";

/**
 * `Spinner` 自带 `role="status"` 与「Loading」这个可访问名（a11y 面板会核），
 * 颜色走 `currentColor`、由父级决定 —— 所以下面这几张展示的是**外壳**而不是
 * 组件本身的变体。
 */
const meta = {
  title: "UI/Spinner",
  component: Spinner,
} satisfies Meta<typeof Spinner>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** 三种尺寸 / 三种容器色：色随 `currentColor`，改父级文字色即可换色。 */
export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <Spinner className="size-3" />
      <Spinner className="size-4" />
      <Spinner className="size-6" />
      <span className="text-primary">
        <Spinner className="size-6" />
      </span>
      <span className="text-ink-muted">
        <Spinner className="size-6" />
      </span>
    </div>
  ),
};

/** 行内进按钮：尺寸由父级的 `[&_svg]` 规则吃住（见 `buttonVariants`）。 */
export const InButton: Story = {
  render: () => (
    <button
      type="button"
      disabled
      className="bg-primary text-primary-foreground inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm opacity-80"
    >
      <Spinner />
      正在生成
    </button>
  ),
};
