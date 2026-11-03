import type { Meta, StoryObj } from "@storybook/nextjs";

import { LogFilterBar } from "~/components/studio/logs/LogFilterBar";
import { useLogPanel } from "~/components/studio/logs/LogProvider";

/**
 * 日志面板行头里的「级别筛选 + 搜索」一组控件（第三层注入 · store 的现场）：`LogFilterBar` 自己
 * 从 store 取 `filter` / `search` 与 setter，story 用 `parameters.storeScene` 写入时间线，计数从
 * **真切片**派生（手抄会在规则改动后继续显示旧值）。要看：选中态不能只靠基元的
 * `data-pressed:bg-muted`（浅色下与行头同值，ISSUE #609）；窄容器下整组折行、标签不被竖排。 */
const meta = {
  title: "Studio/Logs/LogFilterBar",
  component: LogFilterBar,
  parameters: { storeScene: "mixed" },
} satisfies Meta<typeof LogFilterBar>;

export default meta;

/** 类型取自适配件（`originCounts` 的值在 store 里，不在文件里）。 */
type Story = StoryObj<typeof FilterBarHarness>;

/** 适配件：把 `originCounts` 从真 store 切片里读出来（`LogPanel` 里同一行）。 */
function FilterBarHarness() {
  const header = useLogPanel((state) => state.header);
  const origin = header.origin;
  const originCounts = header.countsByOrigin[origin] ?? header.countsByOrigin.all;
  return (
    <div className="border-border-strong bg-surface-1 flex min-h-14 w-240 max-w-full flex-wrap items-center gap-y-1.5 border-b px-4 py-2">
      <LogFilterBar originCounts={originCounts} />
    </div>
  );
}

/** 默认（`mixed`）：五档计数都是真负载，搜索框空着。 */
export const Default: Story = {
  render: () => <FilterBarHarness />,
};

/** 只有警告与错误：三档计数为 0 的那一档现场。 */
export const Sparse: Story = {
  parameters: { storeScene: "errorsOnly" },
  render: () => <FilterBarHarness />,
};

/** 空时间线：全是 `0`（不是「没画出来」，是这一档的数字）。 */
export const Empty: Story = {
  parameters: { storeScene: "empty" },
  render: () => <FilterBarHarness />,
};

/**
 * 只有一路来源：切到单一来源时，级别计数是**该来源自己的数** ——
 * 其余来源那几桶归零，而总数收敛成这一路。
 */
export const SingleOrigin: Story = {
  parameters: { storeScene: "singleOrigin" },
  render: () => <FilterBarHarness />,
};

/**
 * 2600 条：计数是**真负载下**的四位数（搜索框与级别按钮的宽度是否还够）。
 */
export const LongTimeline: Story = {
  parameters: { storeScene: "longTimeline" },
  render: () => <FilterBarHarness />,
};
