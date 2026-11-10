import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { SectionLabel } from "~/components/ui/section-label";

/**
 * `ui/section-label` 是段级小标题那一行的唯一出处（规范 03 §3.10.1）：标题 `text-sm`(14px) `font-semibold`，
 * 右侧 `hint` `text-xs`(12px)，层级由字重与留白承担、不靠字号堆。此前「模式契约」「模型适配」两屏各抄
 * 一份，同一角色两个形状。别在这一行里塞记号（机器 id / 计数 / 胶囊）—— 那是 11–10px 那一档。
 */
const meta = {
  title: "UI/SectionLabel",
  component: SectionLabel,
  args: { children: "选择要配置的模式" },
} satisfies Meta<typeof SectionLabel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 带同行 `hint`：区块小标题 + 一句「这一区在配什么」（两个真实屏的主力形态）。 */
export const WithHint: Story = {
  args: {
    children: "选择要配置的模式",
    hint: "与工作流库同一定义，标「已改」的用你自定义的口",
  },
};

/** 只有标题：`输出类别` 那种不需要补充口径的段头。`args` 逐条写一遍而不是只挂 `meta.args`，让一条故事
 *  自己站住（Args 面板可见初值）；`tests/a11y-axe-stories.test.ts` 取 `meta.args` 与 `story.args` 的浅
 *  合并，两种写法都读得到，漏 `children` 才会被 `empty-heading` 命中。 */
export const TitleOnly: Story = {
  args: { children: "输出类别" },
};
