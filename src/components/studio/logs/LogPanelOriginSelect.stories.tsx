import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";

import { OriginSelect } from "~/components/studio/logs/LogPanelOriginSelect";
import { useLogPanel } from "~/components/studio/logs/LogProvider";
import type { LogOriginCounts, LogOriginFilter } from "~/components/studio/logs/log-store";

/**
 * 日志面板的**来源筛选下拉**（`LogPanel` 的拆分件）。纯 props，但 `countsByOrigin` 必须来自
 * 真时间线派生（手抄计数会在分桶规则或解析正则改动后继续显示旧数字）。要看候选列表那张四列
 * 数字表：「全部来源」按条去重，与下面六档相加不相等（同一批启动行躺在四份文件里，两个口径）。
 */
const meta = {
  title: "Studio/Logs/OriginSelect",
  component: OriginSelect,
  parameters: { storeScene: "mixed" },
} satisfies Meta<typeof OriginSelect>;

export default meta;

/* 类型取自适配件：`countsByOrigin` 从真切片现读，不在文件里手填。 */
type Story = StoryObj<typeof OriginSelectHarness>;

/**
 * 适配件：受控 `value` 自持（切换要看得到效果），计数从**真 store 切片**读。
 * `countsByOrigin` 与 `LogPanel` 里 `OriginSelect` 拿到的是同一份（同一 selector、同一派生），
 * 不另写「story 版计数」。
 */
function OriginSelectHarness({ initial = "all" }: { initial?: LogOriginFilter }) {
  const countsByOrigin = useLogPanel((state): LogOriginCounts => state.countsByOrigin);
  const [value, setValue] = useState<LogOriginFilter>(initial);
  return (
    <div className="bg-canvas-deep border-border-strong w-fit rounded-md border p-3">
      <OriginSelect countsByOrigin={countsByOrigin} onChange={setValue} value={value} />
    </div>
  );
}

/** 默认（`mixed`）：三段来源混在一起，六个分桶里各自都有数。 */
export const Default: Story = {
  render: () => <OriginSelectHarness />,
};

/** 已经选中某一来源：扳机显示的是**来源名**（条数在别处，这里不重复报）。 */
export const SelectedOrigin: Story = {
  render: () => <OriginSelectHarness initial="launcher" />,
};

/**
 * 只有一路来源（`singleOrigin`）：那张二维计数表**塌缩成一维**
 * —— 切过去之前看不出差别，展开候选列表才看得见其余几桶是 0。
 */
export const SingleOrigin: Story = {
  parameters: { storeScene: "singleOrigin" },
  render: () => <OriginSelectHarness />,
};

/** 只有警告与错误：四列数字里 `info` 一列为 0、其余两列非零的那一档。 */
export const ErrorsAndWarnings: Story = {
  parameters: { storeScene: "errorsOnly" },
  render: () => <OriginSelectHarness />,
};

/**
 * **同一批行躺在两份文件里**（`duplicatedOrigins`）：全部来源 = 启动器 = 6，壳侧编排那栏为空——
 * `mergeTimeline()` 按身份去重、不含 origin，时间线只落一份行，计数也只有一份，不是「6 + 6 = 12」。
 * 只有一份副本时「下面几档相加 == 全部来源」看着也成立，那会把两个语义读成同一个。
 */
export const DuplicatedAcrossFiles: Story = {
  parameters: { storeScene: "duplicatedOrigins" },
  render: () => <OriginSelectHarness />,
};

/** 空时间线：每一列都是 0（不是「下拉没画出来」）。 */
export const Empty: Story = {
  parameters: { storeScene: "empty" },
  render: () => <OriginSelectHarness />,
};
