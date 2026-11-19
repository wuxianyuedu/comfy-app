import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { LogRow } from "~/components/studio/logs/LogRow";
import { LOG_ROW_SINGLE } from "~/components/studio/logs/log-virtual";
import { VirtualLogList } from "~/components/studio/logs/VirtualLogList";
import { useExpansionSet } from "~/components/ui/expansion-set";
import { EmptyState } from "~/components/ui/empty-state";
import { sceneEntries, type SceneName } from "../../../../.storybook/store-sources";

/**
 * 日志的**虚拟滚动容器**（两个弹窗共用）。纯 props，没有 store 的事。要看两条职责的「看着正常
 * 其实坏了」形态：窗口计算（坏掉时滚动条长度与内容对不上，第一屏仍正常）；贴底（坏掉时用户上滚
 * 被按回底部）。刻意摆 2600 行 `longTimeline`，行来自真解析链路（`sceneEntries()`）。
 */
const meta = {
  title: "Studio/Logs/VirtualLogList",
  component: VirtualLogList,
} satisfies Meta<typeof VirtualLogList>;

export default meta;

type Story = StoryObj<typeof VirtualLogListHarness>;

/**
 * 适配件：定高框 + 真条目 + `LogRow` 作行渲染器。
 * 定高（`h-96`）是**必须**的：容器的存在意义就是「视口只有这么高」，自然撑开等于关掉虚拟化。
 */
function VirtualLogListHarness({
  scene = "longTimeline",
  following = true,
  wrap = true,
}: {
  following?: boolean;
  scene?: SceneName;
  wrap?: boolean;
}) {
  const entries = sceneEntries(scene);
  const expansion = useExpansionSet({});
  return (
    <div className="bg-canvas-deep border-border-strong flex h-96 w-225 max-w-full flex-col overflow-hidden rounded-md border">
      <VirtualLogList
        emptySlot={<EmptyState description="这一步还没轮到任何一路输出。" title="还没有日志" />}
        entries={entries}
        following={following}
        getId={(entry) => entry.id}
        getMessage={(entry) => entry.message}
        renderRow={(entry) => (
          <LogRow
            entry={entry}
            expanded={expansion.isExpanded(entry.id)}
            keyword=""
            onToggleExpand={expansion.toggle}
            style={{ minHeight: LOG_ROW_SINGLE }}
            wrap={wrap}
          />
        )}
        watch={entries.length}
        wrap={wrap}
      />
    </div>
  );
}

/**
 * 2600 行装进 384px 高的视口：**只渲染视口里那一段**，撑出与内容一致的总高。
 *
 * 这一档要看的正是「第一屏正常」之外的东西：滚动条长度对不上时会露出来。
 */
export const LongTimeline: Story = {
  render: () => <VirtualLogListHarness />,
};

/** 换行档：行高按 `message` 文本折行**估**算（`LOG_ROW_LINE × N`），窗口跟着变。 */
export const Wrapped: Story = {
  render: () => <VirtualLogListHarness wrap />,
};

/**
 * 不换行档：每行钉死成 `LOG_ROW_SINGLE`（一行）。
 * 与 `Wrapped` 对照可看出虚拟化另一面：两种口径「一屏装多少行」不同，但共用同一份窗口计算。
 */
export const NoWrap: Story = {
  render: () => <VirtualLogListHarness wrap={false} />,
};

/** 非跟随态：`following: false` 时新内容进来**不**把用户按回底部。 */
export const NotFollowing: Story = {
  render: () => <VirtualLogListHarness following={false} />,
};

/** 空态：`entries` 为零时走 `emptySlot`（不是「没画出来」）。 */
export const Empty: Story = {
  render: () => <VirtualLogListHarness scene="empty" />,
};
