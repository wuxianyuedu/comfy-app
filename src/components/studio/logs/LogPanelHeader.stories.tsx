import type { Meta, StoryObj } from "@storybook/nextjs";

import { LogPanelHeader } from "~/components/studio/logs/LogPanelHeader";
import { useLogPanel } from "~/components/studio/logs/LogProvider";
import { logSceneArgType } from "../../../../.storybook/store-sources";
import { useWidePanel } from "~/components/ui/wide-panel";
import { modalWidth } from "~/components/ui/dialog-width";

/**
 * 日志面板的行头 —— 标题 + 级别筛选 + 来源下拉 + 一排操作按钮。
 *
 * 这一份是**第三层注入（store）**的现场：行头里三块控件（`LogFilterBar` 的
 * 级别与计数、`OriginSelect` 的候选列表、`SaveExportButton`）**自己从 store
 * 取状态**，不经过 props。所以 story 不能「给几个 props 摆上去完事」——
 * 它得先让 store 里真的有一段时间线（`parameters.storeScene`），
 * 再由适配件把行头要的那几项从**真切片**里读出来。
 *
 * 为什么计数值不能手抄：`originCounts` 是 `countsByOrigin[origin]` 的派生值
 * （「当前来源下的各级别条数」），而 `countsByOrigin` 是 store 按真时间线算的
 * 二维计数表。手抄一个 `{ all: 5, warn: 1, … }` 在日志文案或分桶规则改了之后
 * 仍然看着正常 —— 那就成了「画布上是对的、真机上不对」。
 *
 * 要看三件在真机上容易分叉的事：
 *  · 级别按钮上的计数随**当前来源**变（与来源下拉同口径，两边永远对得上）；
 *  · 窄窗口下筛选器整组折到第二行（判据是 `min-w-56`），标签不被切成竖排单字；
 *  · 操作按钮的成败反馈（复制失败是原地换文案，不是静静不变）。
 */
const meta = {
  title: "Studio/Logs/LogPanelHeader",
  component: LogPanelHeader,
  /* 行头自身没有必填 props（它全部从 store / 适配件拿），这里只声明场景。 */
  parameters: { storeScene: "mixed" },
} satisfies Meta<typeof LogPanelHeader>;

export default meta;

/* story 的类型取自**适配件**：本组故事一律用 `render` 摆行头，`args` 是
   适配件从真 store 切片里现读的（`LogPanelHeader` 自己的 props 全是必填，
   而它们的值在 store 里、不在文件里 —— 硬填一份就是手抄状态）。 */
type Story = StoryObj<typeof HeaderHarness>;

/**
 * 适配件：把行头要的 props 从**真 store 切片**里读出来。
 *
 * 这正是 `LogPanel` 里那几行的写法（同一个 `useLogPanel`、同一个派生），
 * 不另写一份「story 版状态」。`log-scene` 一类的旋钮留在 `parameters` 上
 * （见 `store-sources.tsx` 的说明）。
 */
function HeaderHarness({ wrapInitial = false }: { wrapInitial?: boolean }) {
  const header = useLogPanel((state) => state.header);
  const setOrigin = useLogPanel((state) => state.setOrigin);
  const setIsOpen = useLogPanel((state) => state.setIsOpen);
  const download = useLogPanel((state) => state.download);
  const clear = useLogPanel((state) => state.clear);
  const copyAll = useLogPanel((state) => state.copyAll);
  const panel = useWidePanel("log-panel-header-story", modalWidth("max-w-4xl"));

  const origin = header.origin;
  const originCounts =
    header.countsByOrigin[origin] ?? header.countsByOrigin.all;

  return (
    <div className="w-240 max-w-full">
      <LogPanelHeader
        originCounts={originCounts}
        countsByOrigin={header.countsByOrigin}
        origin={origin}
        setOrigin={setOrigin}
        wrap={wrapInitial}
        setWrap={() => undefined}
        copyFailed={false}
        copyDone={false}
        copyAllAction={() => void copyAll()}
        scopeLabel="全部来源 · 全部级别"
        total={header.filteredLogs.length}
        download={download}
        clear={clear}
        panel={panel}
        setIsOpen={setIsOpen}
      />
    </div>
  );
}

/** 默认（`mixed` 场景）：三段来源混在一起，计数与来源分桶都是真负载。 */
export const Default: Story = {
  render: () => <HeaderHarness />,
};

/** 只有警告与错误：级别按钮上其余几档计数为 0 的那一档现场。 */
export const ErrorsAndWarnings: Story = {
  parameters: { storeScene: "errorsOnly" },
  render: () => <HeaderHarness />,
};

/** 空时间线：`0` 条时的行头（不是「没有画布」，是数字都是 0 的那一档）。 */
export const Empty: Story = {
  parameters: { storeScene: "empty" },
  render: () => <HeaderHarness />,
};

/** 自动换行档打开：`wrap` 那枚按钮是选中态（否则它在浅色主题下与底色同值）。 */
export const WrapEnabled: Story = {
  render: () => <HeaderHarness wrapInitial />,
};

/* 场景名清单由注入层给（`logSceneArgType()` 是 Args 面板的下拉选项源）。
   这一行的用意只是把「有哪些场景」在 story 文件里留个可见的入口 ——
   story 自己的场景声明在 `parameters.storeScene` 上（见文件头）。 */
void logSceneArgType;

/**
 * 只有一路来源（`singleOrigin`）：来源分桶塌缩成一维时的行头
 * —— 计数与「全部来源」那一档不相等的那条口径在这看。
 */
export const SingleOrigin: Story = {
  parameters: { storeScene: "singleOrigin" },
  render: () => <HeaderHarness />,
};

/**
 * 2600 条：总数是四位数时行头的宽度（「共 N 条」与作用域标签还不挤在一起）。
 */
export const LongTimeline: Story = {
  parameters: { storeScene: "longTimeline" },
  render: () => <HeaderHarness />,
};
