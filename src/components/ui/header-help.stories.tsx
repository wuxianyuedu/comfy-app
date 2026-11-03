import type { Meta, StoryObj } from "@storybook/nextjs";

import { HeaderHelp } from "~/components/ui/header-help";

/** `HeaderHelp` —— 悬浮「说明」按钮，全库唯一实现（规范 16 §16.2.3 / §12.18）。
 * 它原本只服务 `PageHeader`（把页头那句解释收成一颗按钮、不占标题区一行，ISSUE #1693）；现在视图说明统一挂到顶栏视图标题右侧（`TopBar` + `studio/ViewHelp` 的 `viewHelp()` 注册表），屏内页头不再重复显示屏名 —— 两个宿主共用这一颗按钮，形状才不会漂。
 * 本 story 只看一件事：那颗按钮的尺寸与位置感。问号与正文字号同大（`size-3.5` = 14px，与顶栏视图标题的 `text-sm` 一致），按钮收 `icon-xs` 只为留住点击区；文案长短不影响按钮本身，提示内容要悬停才出现（`Hint` 的口径）。
 * 没有说明可放的宿主不渲染它（「没有说明的不显示」）—— 那是调用方的判据，不在本组件的 props 里。 */
const meta = {
  title: "UI/HeaderHelp",
  component: HeaderHelp,
  args: {
    text: "所有生成任务与执行日志，按时间倒序排列。",
  },
} satisfies Meta<typeof HeaderHelp>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 常驻档：顶栏标题右侧就是这么一颗（历史屏的文案）。 */
export const Default: Story = {};

/** 长文案（模式契约那句）：按钮不变，悬停展开的内容变长。 */
export const LongText: Story = {
  args: {
    text: "每种模式的统一输入 / 输出 —— 本地工作流按它配落点，远端模型按它建适配器。契约是模式级的全局口径，与具体接口无关（接口字段映射在「模型适配」里配）。",
  },
};
