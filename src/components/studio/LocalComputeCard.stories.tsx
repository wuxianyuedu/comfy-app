import type { Meta, StoryObj } from "@storybook/nextjs";

import { LocalComputeCard } from "~/components/studio/LocalComputeCard";

/**
 * 首页那张「本机算力」卡 —— `studio/` 这一批里第一个吃运行期数据的 story。
 *
 * ## 它在画布上长什么样
 *
 * 读数是 `useComfyReadiness()`（打 `/api/comfy/stats` 与队列那条链路）。
 * 这张卡**默认给你看的是降级形态** —— 「离线 / ComfyUI 未运行，显存内存暂不可用」。
 * 那不是 story 坏了，是真机上 ComfyUI 没起时用户看到的东西。
 *
 * 为什么这已经够用：这一档恰恰是**真机上最难复现**的形态（要么把后端全起起来、
 * 要么一个都不起），而它又是用户抱怨最多的那一档。用预设数据搭一张「看着很丰满」
 * 的卡，等于把这一档从故事里删掉。
 *
 * ## 想看有数据的样子
 *
 * 需要 ComfyUI 真的在跑（本机缺它时连 `/api/comfy/stats` 也只会回
 * `{"online":false,…}`），并且工作台要**同源**访问应用 —— 跨源那道门槛是真的，
 * 完整口径（以及为什么刻意不给它开 CORS）写在
 * `.storybook/data-sources.tsx` 的 `StorybookTrpcProvider` 注释里。
 */
const meta = {
  title: "Studio/LocalComputeCard",
  component: LocalComputeCard,
  parameters: {
    docs: {
      description: {
        component:
          "吃运行期数据的卡片：默认看到的是它真实的降级形态（后端不可用），不是假数据。",
      },
    },
  },
} satisfies Meta<typeof LocalComputeCard>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * 唯一一条 story —— 这张卡没有可调的 props（形态完全由读数决定）。
 *
 * 「多一条 story」在这里没有意义：变体不是「换个 props 看看」，而是
 * 「换一台机器 / 换一个起没起的后端」。要那种对照面，请在**两个状态下各跑一次**
 *（先把 ComfyUI 起起来），画布上的差别就是这张卡要验的全部。
 */
export const Default: Story = {};
