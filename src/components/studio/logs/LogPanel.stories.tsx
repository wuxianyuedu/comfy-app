import type { Meta, StoryObj } from "@storybook/nextjs";

import { LogPanel } from "~/components/studio/logs/LogPanel";
import { useLogPanel } from "~/components/studio/logs/LogProvider";
import { useEffect } from "react";

/**
 * 日志面板的**整块** —— 第三层注入（store）最有分量的一份。
 *
 * 它一个 prop 都不收（`LogPanel()` 从 store 读全部状态），所以「摆上去」这件事
 * 只有一条路可走：先让 store 里真的有一段时间线。这正是
 * `parameters.storeScene` 干的事 —— 原文由 store 自己的 `parseFileLogs()` 解析、
 * 经真 action `appendFileLogs()` 落板，于是**计数、来源分桶、时间线排序、行高
 * 窗口全由生产代码算出来**。
 *
 * 为什么不直接 `useLogStore.setState({ logs: [...] })`：那样画布也会出现内容，
 * 但它把「解析 + 派生」两条链路整个跳过 —— 验的成了「store 能不能存数组」，
 * 不是「面板长什么样」。
 *
 * 要看的是这一块里几处真机上容易分叉、构建与门禁全都看不出来的东西：
 *
 *  · **同一毫秒的排序**（`(time, seq)` 次键，`rowShapes` 那一段刻意挤在同一秒）；
 *  · **来源分桶的守恒**（四处文件来源 + 控制台 = 全部，切一个来源时计数跟着变）；
 *  · **来源下拉的弹层不被面板遮罩压住**（`log-panel-layers` 那条严格大于的契约 ——
 *    jsdom 不做层叠与命中测试，只有真浏览器里点得中才知道）；
 *  · **贴底与「用户上滚后不被按回底部」**（`use-log-panel-pin` 的基线）。
 */
const meta = {
  title: "Studio/Logs/LogPanel",
  component: LogPanel,
  parameters: { storeScene: "mixed" },
} satisfies Meta<typeof LogPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * 面板打开态。`LogPanel` 从 store 读 `isOpen`，story 侧不通过 props 打开它 ——
 * 所以这里给一个包住它的适配件，在挂载时用**真 action** `setIsOpen(true)`
 * 把它打开（与点状态栏那枚按钮走的是同一条路）。
 */
function OpenPanelHarness() {
  const setIsOpen = useLogPanel((state) => state.setIsOpen);
  /* 用**真 action** 打开面板（与点状态栏那枚按钮同一条路）—— 面板的 `isOpen`
     住在 store 里，props 给不进去。`useEffect` 在 `withStoreScene` 写场景之后跑
     （装饰器挂在组件树外层），所以这里不会把刚写完的时间线又清掉。 */
  useEffect(() => {
    setIsOpen(true);
  }, [setIsOpen]);
  return <LogPanel />;
}

/** 默认（`mixed`）：三段来源混在一起的真实负载。 */
export const Default: Story = {
  render: () => <OpenPanelHarness />,
};

/** 只有警告与错误：级别按钮上三档计数为 0、其余各档仍在的那一档现场。 */
export const ErrorsAndWarnings: Story = {
  parameters: { storeScene: "errorsOnly" },
  render: () => <OpenPanelHarness />,
};

/** 空时间线：面板打开但零条（不是「没画出来」，是这一档的四个 0）。 */
export const Empty: Story = {
  parameters: { storeScene: "empty" },
  render: () => <OpenPanelHarness />,
};
