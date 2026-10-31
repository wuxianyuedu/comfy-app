import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";

import { OriginSelect } from "~/components/studio/logs/LogPanelOriginSelect";
import { useLogPanel } from "~/components/studio/logs/LogProvider";
import type { LogOriginCounts, LogOriginFilter } from "~/components/studio/logs/log-store";

/**
 * 日志面板的**来源筛选下拉**（`LogPanel` 的拆分件）。
 *
 * 它是**纯 props** 的（`value` / `countsByOrigin` / `onChange`），所以这一组没有
 * store 的事；但那张 `countsByOrigin` **必须**来自真时间线派生 —— 手抄一份
 * `{ launcher: { all: 6, info: 6, … } }` 会在分桶规则或解析正则改了之后继续
 * 显示旧数字，而画布、构建、门禁全绿。所以计数一律从 `useLogPanel` 的真切片里读
 *（与 `LogPanelHeader` 那份同源），`storeScene` 决定时间线长什么样。
 *
 * 要看的是**候选列表里那张四列数字表**，它是这条下拉唯一「切过去之前就能看见」
 * 的东西，也是真机上最容易错的一处：
 *
 *  · 每一列是该级别在该来源下的**行数**（`info` / `warn` / `error` / 合计）；
 *  · 「全部来源」那一档是**按条去重**的条数，与下面六档相加**不相等** ——
 *    同一批启动行躺在 launcher / 启动 / 壳侧编排 / 壳日志四份文件里。这不是
 *    算错，是两个口径（`ORIGIN_TEXT` 的注释写着这条），而把它读成「可相加」
 *    曾经让整批 e2e 必红。
 */
const meta = {
  component: OriginSelect,
  parameters: { storeScene: "mixed" },
  title: "Studio/Logs/OriginSelect",
} satisfies Meta<typeof OriginSelect>;

export default meta;

/* 类型取自适配件：`countsByOrigin` 从真切片现读，不在文件里手填。 */
type Story = StoryObj<typeof OriginSelectHarness>;

/**
 * 适配件：受控 `value` 自持（切换要看得到效果），计数从**真 store 切片**读。
 *
 * `countsByOrigin` 是 store 按真时间线算的二维计数表 —— 与 `LogPanel` 里
 * `OriginSelect` 拿到的**是同一份**（同一个 selector、同一个派生），不另写
 * 一份「story 版计数」。
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
 * **同一批行躺在两份文件里**（`duplicatedOrigins`）：这张表最容易读错的那一档。
 *
 * 实测形态：全部来源 = 启动器 = 6，**壳侧编排那一栏是空的**。两个来源指向同一批
 * 事件时，时间线只落一份行（`mergeTimeline()` 按身份去重、**不含 origin**），
 * 于是计数也只有一份 —— 不是「6 + 6 = 12」。
 *
 * 这一档存在的意义就是这个反直觉的读数：只有一份副本时「下面几档相加 == 全部
 * 来源」看着也成立，而那会把两个不同的语义读成同一个。
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
