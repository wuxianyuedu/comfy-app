import type { Meta, StoryObj } from "@storybook/nextjs";

import { Skeleton } from "~/components/ui/skeleton";

/**
 * `Skeleton` 没有变体轴（一个 `bg-muted animate-pulse rounded-md` 的方块），
 * 形态全由调用处给的尺寸类决定，所以这里铺的是**用法**而不是枚举。
 */
const meta = {
  title: "UI/Skeleton",
  component: Skeleton,
  args: { className: "h-4 w-48" },
} satisfies Meta<typeof Skeleton>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** 一行的形状：头像方块 + 两行文字，`w-3/4` 那行表达「最后一行不必满宽」。 */
export const ListRow: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Skeleton className="size-8 rounded-full" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-3 w-24" />
      </div>
    </div>
  ),
};

/** 卡片骨架：封面 + 标题 + 元信息，尺寸类组合出层次。 */
export const Card: Story = {
  render: () => (
    <div className="border-border w-64 rounded-lg border p-3">
      <Skeleton className="mb-3 h-28 w-full rounded-md" />
      <Skeleton className="mb-2 h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  ),
};
