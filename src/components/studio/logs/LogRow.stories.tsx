import type { Meta, StoryObj } from "@storybook/nextjs";

import { LogRow } from "~/components/studio/logs/LogRow";
import { useExpansionSet } from "~/components/ui/expansion-set";
import { LOG_ROW_SINGLE } from "~/components/studio/logs/log-virtual";
import { sceneEntries, type SceneName } from "../../../../.storybook/store-sources";

/**
 * 一行日志 —— 面板里被读得最多的那一格。纯 props，要守的口径是**`entry` 必须来自真解析链路**：
 * `seq` / `origin` 与解析层取舍，加上 JSON 折叠 / 路径识别 / 关键词高亮都按那几个字段分叉，
 * 手捏字面量会让三处悄悄走错分支。条目一律调 `sceneEntries()`（内部即 `parseFileLogs()`）；
 * `rowShapes` 带齐三种形态：comfy-cli 原始 JSON（可展开）、含 `log/exports/…` 的行、`文件:行号`。 */
const meta = {
  title: "Studio/Logs/LogRow",
  component: LogRow,
} satisfies Meta<typeof LogRow>;

export default meta;

type Story = StoryObj<typeof LogRowHarness>;

/**
 * 适配件：持有展开集合与关键词（两者归**面板**，不是行自己的状态），条目录自注入层真解析结果。
 * 展开集合走 `useExpansionSet`——它就是 `LogPanel` 里那份；手写 `{ ...prev, [id]: !prev[id] }`
 * 会撞 P14 硬闸（同一件事在视图里又写一遍样板，story 也是视图的一侧）。
 */
function LogRowHarness({
  scene = "rowShapes",
  wrap = true,
  keyword = "",
  expandFirst = false,
}: {
  expandFirst?: boolean;
  keyword?: string;
  scene?: SceneName;
  wrap?: boolean;
}) {
  const entries = sceneEntries(scene);
  const expansion = useExpansionSet(expandFirst && entries[0] ? { [entries[0].id]: true } : {});
  if (entries.length === 0) {
    return (
      <div className="text-ink-muted p-4 text-sm">场景「{scene}」没有条目 —— 换一个场景。</div>
    );
  }
  return (
    <div className="bg-canvas-deep border-border-strong w-225 max-w-full overflow-hidden rounded-md border">
      {entries.map((entry) => (
        <LogRow
          entry={entry}
          expanded={expansion.isExpanded(entry.id)}
          key={entry.id}
          keyword={keyword}
          onToggleExpand={expansion.toggle}
          style={{ minHeight: LOG_ROW_SINGLE }}
          wrap={wrap}
        />
      ))}
    </div>
  );
}

/** 三行分叉齐备（`rowShapes`）：折叠的 JSON 行、可点的路径、错误级别。 */
export const Shapes: Story = {
  render: () => <LogRowHarness />,
};

/** 展开那一行：`JsonViewer` 接管完整 JSON（折叠态只有一行摘要）。 */
export const ExpandedJson: Story = {
  render: () => <LogRowHarness expandFirst />,
};

/** 关键词高亮：命中判据与 `matchesSearch` 同源（折小写），否则「行选中了字没高亮」。 */
export const KeywordHighlight: Story = {
  render: () => <LogRowHarness keyword="SQLITE_BUSY" />,
};

/** 不换行档：长消息被钉死成一行（`overflow-hidden` 不让它溢到下一行上）。 */
export const NoWrap: Story = {
  render: () => <LogRowHarness wrap={false} />,
};

/** 三段来源混在一起（`mixed`）：级别徽标四档并排的真实负载。 */
export const MixedOrigins: Story = {
  render: () => <LogRowHarness scene="mixed" />,
};

/** 一批可展开的 comfy-cli 原文行（`cliExpandable`）：全部折叠成一行摘要的形态。 */
export const CliRowsCollapsed: Story = {
  render: () => <LogRowHarness scene="cliExpandable" />,
};

/**
 * 同一批行里的**第一条**展开：折叠态与展开态在**同一条时间线**上并排 ——
 * 展开集合是多选集合，不是单选，行高按 id 各自算（对不齐时滚动会错开）。
 */
export const CliRowsExpanded: Story = {
  render: () => <LogRowHarness expandFirst scene="cliExpandable" />,
};

/** 同一毫秒的多行：`(time, seq)` 邻近行的级别徽标与正文并排的真实负载。 */
export const SameMillisecond: Story = {
  render: () => <LogRowHarness scene="sameMillisecond" />,
};
