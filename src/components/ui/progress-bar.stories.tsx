import type { Meta, StoryObj } from "@storybook/nextjs";

import { ProgressBar } from "~/components/ui/progress-bar";

/**
 * `value` 收的是**算好的百分比**（0..100），`null` 表示不确定态。数值怎么算
 * 归 `~/lib/progress`，本件只管形态：轨道 / 填充 / 百分比文字 / ARIA。
 *
 * 有一组边界只在这里看得见（`0` / `0 < p < minVisible` / 超范围 / 非有限数），
 * 所以下面按「谁消费它」分组，而不是按数值档分组。
 */
const meta = {
  title: "UI/ProgressBar",
  component: ProgressBar,
  args: { value: 42, label: "正在解析节点包" },
  argTypes: {
    value: { control: { type: "range", min: 0, max: 100 } },
  },
} satisfies Meta<typeof ProgressBar>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** 确定 / 不确定（`null`，条纹来回滑动）/ 不给标题行（条上没字，要补 `ariaLabel`）。 */
export const Modes: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-5">
      <ProgressBar value={42} label="正在解析节点包" />
      <ProgressBar value={null} label="正在扫描…" />
      <ProgressBar value={68} ariaLabel="画布加载进度" />
    </div>
  ),
};

/**
 * 三档数值边界：`0`（就是空条）/ `minVisible=4`（0% 也留一格）/ 超范围
 * （`-1` 与 `120` 都被夹到端点，百分比文字也取夹取后的值）。
 */
export const Values: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-5">
      <ProgressBar value={0} label="0%" />
      <ProgressBar value={0} minVisible={4} label="0% + minVisible" />
      <ProgressBar value={-1} label="越界下（-1）" />
      <ProgressBar value={120} label="越界上（120）" />
    </div>
  ),
};

/** `showValue={false}`：只要进度条、不要右边的百分比文字。 */
export const WithoutValueText: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-5">
      <ProgressBar value={33} label="上传中" showValue={false} />
      <ProgressBar value={33} showValue={false} ariaLabel="无标题行的进度" />
    </div>
  ),
};

/** 工坊顶栏那种「一段一根细条」：`trackClassName` / `fillClassName` 改档，
 *  条上没字所以补 `ariaLabel`。 */
export const CompactSegments: Story = {
  render: () => (
    <div className="flex w-80 items-center gap-1">
      {[100, 100, 60, 0].map((value, index) => (
        <ProgressBar
          key={index}
          value={value}
          showValue={false}
          ariaLabel={`第 ${index + 1} 阶段`}
          trackClassName="h-0.5"
          className="w-16"
        />
      ))}
    </div>
  ),
};
