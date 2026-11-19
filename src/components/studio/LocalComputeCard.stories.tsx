import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { LocalComputeCard } from "~/components/studio/LocalComputeCard";

/**
 * 首页那张「本机算力」卡 —— `studio/` 这一批里第一个吃运行期数据的 story，读数是 `useComfyReadiness()`（打 `/api/comfy/stats` 与队列链路）。
 * **默认给你看降级形态**「ComfyUI 未运行，显存内存暂不可用」—— 那不是 story 坏了：这一档恰是真机最难复现又抱怨最多的，用预设数据搭「丰满」的卡等于把它从故事里删掉。
 * 要看成活数据需 ComfyUI 真在跑且工作台**同源**（跨源门槛是真的，完整口径见 `.storybook/data-sources.tsx` 的 `StorybookTrpcProvider` 注释）。
 */
const meta = {
  title: "Studio/LocalComputeCard",
  component: LocalComputeCard,
  parameters: {
    docs: {
      description: {
        component: "吃运行期数据的卡片：默认看到的是它真实的降级形态（后端不可用），不是假数据。",
      },
    },
  },
} satisfies Meta<typeof LocalComputeCard>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * 唯一一条 story —— 这张卡没有可调 props（形态完全由读数决定）。变体不是「换 props 看看」，而是
 * 「换一台机器 / 换一个起没起的后端」：要那种对照面，请在两个状态下各跑一次，画布上的差别就是要验的全部。
 */
export const Default: Story = {};
