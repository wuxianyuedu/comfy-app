import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { TruncatedText } from "~/components/ui/truncated-text";

/**
 * `TruncatedText` 是「文字被截成省略号」的唯一实现（ISSUE #3790）：只在**真的**被
 * 截断时出悬停提示，提示里是完整原文；没截断时不出浮层。
 * 承载文字的就是调用点原本那个元素（类名原样传进来），`Hint` 走 Base UI 的 `render`
 * prop 接管同一个元素 —— 不多套一层 DOM，flex / grid 里的收缩与截断表现逐字不变。
 */
const meta = {
  title: "UI/TruncatedText",
  component: TruncatedText,
  args: {
    children: "一个很长的模型名，被窄列截断成省略号",
    className: "block max-w-40 truncate text-sm",
  },
} satisfies Meta<typeof TruncatedText>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 窄列里的截断：悬停出完整原文。 */
export const Truncated: Story = {};
