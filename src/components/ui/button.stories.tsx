import type { Meta, StoryObj } from "@storybook/nextjs";

import { Button, ButtonLink } from "~/components/ui/button";
import { Icon } from "~/components/ui/icon";

/**
 * 变体/尺寸清单从 `Button` 的 props 里派生（`VariantProps` 已在组件侧对
 * `buttonVariants` 求过值），而不是二写一份字面量数组 —— 新增一档变体时
 * 这里跟着类型报错，不会出现「故事里悄悄少了那一档」。
 *
 * 不能写 `buttonVariants.variants.variant`：`cva()` 的返回值是一个
 * `(props?) => string` 的**函数**，运行时并没有 `.variants`（只在 TS 泛型里
 * 存在）。那样写 tsc 会红、storybook 会在加载期抛 `Cannot read properties of
 * undefined` —— 即「索引里有故事、画布上什么都没有」。
 */
type ButtonVariant = NonNullable<
  React.ComponentProps<typeof Button>["variant"]
>;
type ButtonSize = NonNullable<React.ComponentProps<typeof Button>["size"]>;

const VARIANTS: ButtonVariant[] = [
  "default",
  "outline",
  "secondary",
  "ghost",
  "destructive",
  "primary",
  "danger",
  "success",
  "warning",
  "info",
  "primary-solid",
  "danger-solid",
  "success-solid",
  "warning-solid",
  "link",
];
const SIZES: ButtonSize[] = ["xs", "sm", "default", "lg", "icon", "icon-xs"];

const meta = {
  title: "UI/Button",
  component: Button,
  args: { children: "按钮" },
  argTypes: {
    variant: { control: "select", options: VARIANTS },
    size: { control: "select", options: SIZES },
  },
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** 全部变体铺开——评审改 `buttonVariants` 时第一眼就能看出哪一档变了。 */
export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      {VARIANTS.map((variant) => (
        <Button key={variant} {...args} variant={variant}>
          {variant}
        </Button>
      ))}
    </div>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      {SIZES.map((size) => (
        <Button key={size} {...args} size={size}>
          {size}
        </Button>
      ))}
    </div>
  ),
};

export const WithIcon: Story = {
  render: (args) => (
    <Button {...args}>
      <Icon name="plus" />
      新建项目
    </Button>
  ),
};

export const Disabled: Story = {
  args: { disabled: true },
};

/** `ButtonLink` 渲染成 `next/link`——story 里同时覆盖到 Next 运行期解析。 */
export const AsLink: Story = {
  render: () => (
    <ButtonLink href="/workspace" variant="outline">
      去工作区
    </ButtonLink>
  ),
};
