import type { Meta, StoryObj } from "@storybook/nextjs";

import { SectionLabel } from "~/components/ui/section-label";

/**
 * `ui/section-label` 是**段级小标题那一行**的唯一出处（规范 03 §3.10.1）：
 * 标题走 `text-sm`(14px) `font-semibold`、右侧 `hint` 走 `text-xs`(12px)，
 * **层级由字重与留白承担、不靠字号堆**。
 *
 * 它此前是「模式契约」「模型适配」两屏各抄一份的实现 —— 同一个角色两个形状。
 * 这里的两个 story 直接对着那两个真实落点给：标题带 hint（契约的口清单）
 * 与只有标题（输出类别）。**别在这一行里塞记号**（机器 id / 计数 / 胶囊）——
 * 那是 11–10px 那一档，混进来正是这一批要治的漂移。
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

/** 只有标题：`输出类别` 那种不需要补充口径的段头。
 *
 * `args` 逐条写一遍而不是只挂 `meta.args`：一条故事要能自己站住 —— Args 面板里看得见
 * 这一条的初值，读者切到它不必先回 meta 找。（`tests/a11y-axe-stories.test.ts` 按
 * Storybook 的语义渲染：`story.render ?? meta.render`，args 取 `meta.args` 与
 * `story.args` 的浅合并 —— 两种写法它都读得到，漏 `children` 才是会被
 * `empty-heading` 命中的那个形态。） */
export const TitleOnly: Story = {
  args: { children: "输出类别" },
};
