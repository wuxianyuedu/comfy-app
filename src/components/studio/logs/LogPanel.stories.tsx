import type { Meta, StoryObj } from "@storybook/nextjs";

import { LogPanel } from "~/components/studio/logs/LogPanel";
import { useLogPanel } from "~/components/studio/logs/LogProvider";
import { useEffect } from "react";

/**
 * 日志面板的**整块** —— 第三层注入（store）最有分量的一份：它一个 prop 都不收，只能先让 store 里真有一段时间线，`parameters.storeScene` 用 `parseFileLogs()` 解析、经 `appendFileLogs()` 落板，计数/分桶/排序/行高窗口全由生产代码算。
 * 要看：同毫秒排序（`(time, seq)`）、来源分桶守恒、下拉弹层不被遮罩压住、贴底与上滚不回底。 */
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

/**
 * 同一毫秒十几行：排序要看 `(time, seq)` 次键。
 * 只按 `time` 排时同毫秒内顺序不稳定（每轮重渲染都可能换位），而这条时间线全是同刻行。
 */
export const SameMillisecond: Story = {
  parameters: { storeScene: "sameMillisecond" },
  render: () => <OpenPanelHarness />,
};

/**
 * 2600 条：翻页窗口与行高窗口的真实负载（`LOG_PAGE_SIZE` = 2000，所以第 1 页
 * 之外还有货）。面板是虚拟化的 —— 这一档让「量不到视口时整页渲染」与「量得到
 * 时按窗口渲染」两条分支都有真负载可走。
 */
export const LongTimeline: Story = {
  parameters: { storeScene: "longTimeline" },
  render: () => <OpenPanelHarness />,
};
