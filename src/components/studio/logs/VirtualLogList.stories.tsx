import type { Meta, StoryObj } from "@storybook/nextjs";

import { LogRow } from "~/components/studio/logs/LogRow";
import { LOG_ROW_SINGLE } from "~/components/studio/logs/log-virtual";
import { VirtualLogList } from "~/components/studio/logs/VirtualLogList";
import { useExpansionSet } from "~/components/ui/expansion-set";
import { EmptyState } from "~/components/ui/empty-state";
import {
  sceneEntries,
  type SceneName,
} from "../../../../.storybook/store-sources";

/**
 * 日志的**虚拟滚动容器** —— 两个弹窗（`GlobalStepLogPanel` /
 * `WorkflowRunLogModal`）共用的那一份。
 *
 * 它是**纯 props**（`entries` / `getMessage` / `renderRow` …），所以这一组里没有
 * store 的事。要摆的是它**自己**的两条职责，它们在真机上各有一种「看着正常、
 * 其实坏了」的形态：
 *
 *  · **窗口计算**：只把视口里的那几十行挂进 DOM（满页 2000 行时 DOM 节点数不再
 *    随页大小涨）。坏掉的样子是滚动条长度与内容对不上 —— 而画布上第一屏**完全
 *    正常**，因为第一屏永远在窗口里；
 *  · **贴底（follow）**：跟随态下「内容变了」就滚到底。坏掉的样子是「用户上滚读
 *    历史被按回底部」，同样只在**滚动之后**才看得见。
 *
 * 所以这里刻意摆了「一页之外还有货」的 `longTimeline`（2600 行）：第一屏与滚动
 * 到中段的形态要能同时看到。行仍然**来自真解析链路**（`sceneEntries()`，见
 * `store-sources.tsx`）—— 手捏 `entries` 字面量会绕过 `getMessage` 依赖的那几个
 * 字段（行高估算正是按 `message` 文本折行算的）。
 */
const meta = {
  title: "Studio/Logs/VirtualLogList",
  component: VirtualLogList,
} satisfies Meta<typeof VirtualLogList>;

export default meta;

type Story = StoryObj<typeof VirtualLogListHarness>;

/**
 * 适配件：定高框 + 真条目 + `LogRow` 作行渲染器。
 *
 * 定高是**必须**的（`h-96`）：这个组件的整个存在意义就是「视口只有这么高」，
 * 让容器自然撑开等于关掉虚拟化、把这一组要看的窗口计算整块跳过。
 */
function VirtualLogListHarness({
  scene = "longTimeline",
  following = true,
  wrap = true,
}: {
  scene?: SceneName;
  following?: boolean;
  wrap?: boolean;
}) {
  const entries = sceneEntries(scene);
  const expansion = useExpansionSet({});
  return (
    <div className="bg-canvas-deep border-border-strong flex h-96 w-225 max-w-full flex-col overflow-hidden rounded-md border">
      <VirtualLogList
        entries={entries}
        getMessage={(entry) => entry.message}
        getId={(entry) => entry.id}
        watch={entries.length}
        following={following}
        wrap={wrap}
        emptySlot={
          <EmptyState
            title="还没有日志"
            description="这一步还没轮到任何一路输出。"
          />
        }
        renderRow={(entry) => (
          <LogRow
            entry={entry}
            wrap={wrap}
            keyword=""
            expanded={expansion.isExpanded(entry.id)}
            onToggleExpand={expansion.toggle}
            style={{ minHeight: LOG_ROW_SINGLE }}
          />
        )}
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
 *
 * 与 `Wrapped` 一对照就能看出虚拟化的另一面 —— 两种口径下「一屏装多少行」不同，
 * 而它们**共用同一份窗口计算**（`log-virtual` 的行高常量）。
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
