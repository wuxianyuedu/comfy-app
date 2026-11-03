import type { Meta, StoryObj } from "@storybook/nextjs";

import { HomeModelOverview } from "~/components/studio/HomeModelOverview";

/**
 * 首页「模型概览」卡 —— 与 `LocalComputeCard` 同族：吃运行期数据，**不 mock**。四种形态都由真实读数决定
 * 且在真机都会出现：骨架屏（`m.loading`）、错误态（`m.error`，后端不可用 / 跨源被拦）、空目录、有内容。
 * 前两种真机难复现，在这里反而是默认态 —— 降级形态有人看。要有内容的前提见 `.storybook/data-sources.tsx` 的 `StorybookTrpcProvider` 注释。
 */
const meta = {
  title: "Studio/HomeModelOverview",
  component: HomeModelOverview,
  parameters: {
    docs: {
      description: {
        component: "吃运行期数据的卡片：骨架屏 / 错误态 / 空目录 / 有内容四态都由真读数决定。",
      },
    },
  },
} satisfies Meta<typeof HomeModelOverview>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 唯一一条 story（无可调 props）：形态由真读数决定，见文件头那张表。 */
export const Default: Story = {};
