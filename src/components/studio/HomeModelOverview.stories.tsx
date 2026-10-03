import type { Meta, StoryObj } from "@storybook/nextjs";

import { HomeModelOverview } from "~/components/studio/HomeModelOverview";

/**
 * 首页「模型概览」卡 —— 与 `LocalComputeCard` 同族：吃运行期数据，**不 mock**。
 *
 * 它的几种形态由真实读数决定，而**每一种在真机上都会出现**：
 *
 * | 形态 | 什么时候 | 谁在决定 |
 * | ---- | -------- | -------- |
 * | 骨架屏 | 首帧（数据还没到） | `m.loading` |
 * | 错误态 | 拉取失败（后端不可用 / 跨源被拦） | `m.error` |
 * | 空目录 | 扫到了目录、一个模型都没有 | 推导结果为空 |
 * | 有内容 | 有模型目录 | `model-overview-derive.ts` |
 *
 * 前两种属于「真机上难得复现」的一类，在这里反而是默认状态之一 —— 这就是不给它
 * 搭假数据的好处：**降级形态有人看**。
 *
 * 想看「有内容」那一档的前提（后端起来 + 同源）写在 `LocalComputeCard` 那条 story
 * 与 `.storybook/data-sources.tsx` 的 `StorybookTrpcProvider` 注释里。
 */
const meta = {
  title: "Studio/HomeModelOverview",
  component: HomeModelOverview,
  parameters: {
    docs: {
      description: {
        component:
          "吃运行期数据的卡片：骨架屏 / 错误态 / 空目录 / 有内容四态都由真读数决定。",
      },
    },
  },
} satisfies Meta<typeof HomeModelOverview>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 唯一一条 story（无可调 props）：形态由真读数决定，见文件头那张表。 */
export const Default: Story = {};
