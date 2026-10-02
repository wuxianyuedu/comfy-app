import type { Meta, StoryObj } from "@storybook/nextjs";

import { Badge } from "~/components/ui/badge";

/**
 * 三轴清单从 `Badge` 的 props 派生 —— 理由与写法与 `button.stories.tsx`
 * 一致（`cva()` 的返回值运行时没有 `.variants`，见该文件注释）。
 */
type BadgeVariant = NonNullable<React.ComponentProps<typeof Badge>["variant"]>;
type BadgeTone = NonNullable<React.ComponentProps<typeof Badge>["tone"]>;
type BadgeSize = NonNullable<React.ComponentProps<typeof Badge>["size"]>;

const VARIANTS: BadgeVariant[] = [
  "default",
  "secondary",
  "destructive",
  "outline",
  "ghost",
  "link",
];
const TONES: BadgeTone[] = [
  "success",
  "warning",
  "danger",
  "primary",
  "neutral",
];
const SIZES: BadgeSize[] = ["default", "sm", "xs"];

const meta = {
  title: "UI/Badge",
  component: Badge,
  args: { children: "徽标" },
  argTypes: {
    variant: { control: "select", options: VARIANTS },
    tone: { control: "select", options: TONES },
    size: { control: "select", options: SIZES },
  },
} satisfies Meta<typeof Badge>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** 三轴是独立的（variant 基线 × tone 语义色 × size 密度），故拆三张矩阵。 */
export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-2">
      {VARIANTS.map((variant) => (
        <Badge key={variant} {...args} variant={variant}>
          {variant}
        </Badge>
      ))}
    </div>
  ),
};

export const Tones: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-2">
      {TONES.map((tone) => (
        <Badge key={tone} {...args} tone={tone}>
          {tone}
        </Badge>
      ))}
    </div>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-2">
      {SIZES.map((size) => (
        <Badge key={size} {...args} size={size}>
          {size}
        </Badge>
      ))}
    </div>
  ),
};
