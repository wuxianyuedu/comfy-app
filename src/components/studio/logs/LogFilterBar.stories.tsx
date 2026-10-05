import type { Meta, StoryObj } from "@storybook/nextjs";

import { LogFilterBar } from "~/components/studio/logs/LogFilterBar";
import { useLogPanel } from "~/components/studio/logs/LogProvider";

/**
 * 日志面板行头里的「级别筛选 + 搜索」一组控件（第三层注入 · store 的现场）。
 *
 * `LogFilterBar` 只收一个 prop（`originCounts`，当前来源下各级别的条数），
 * 而它**自己**从 store 取 `filter` / `search` / 两个 setter —— 所以 story 得先
 * 让 store 里有一段时间线（`parameters.storeScene`），再把那个计数从**真切片**
 * 里读出来。
 *
 * 为什么计数不能手抄：它是 `countsByOrigin[origin]` 的派生值，而那张二维表是
 * store 按真时间线算的。手抄一份在分桶规则或计数口径改了之后仍然看着正常。
 *
 * 要看的是：**选中态不能只靠基元的 `data-pressed:bg-muted`**
 *（它解析到 `--color-subtle`，浅色主题下与行头底色同值 —— 那正是 ISSUE #609），
 * 以及**窄容器下整组折行、标签不被切成竖排单字**（判据是 `min-w-56`）。
 */
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
  const originCounts =
    header.countsByOrigin[origin] ?? header.countsByOrigin.all;
  return (
    <div className="border-border-strong bg-surface-1 flex min-h-14 w-[960px] max-w-full flex-wrap items-center gap-y-1.5 border-b px-4 py-2">
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
