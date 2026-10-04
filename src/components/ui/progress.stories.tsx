import type { Meta, StoryObj } from "@storybook/nextjs";

import {
  Progress,
  ProgressIndicator,
  ProgressLabel,
  ProgressTrack,
  ProgressValue,
} from "~/components/ui/progress";

/**
 * `ui/progress` 是 base-ui 的 Progress 原语，**与 `ui/progress-bar` 不是同一件**：
 *
 * - `progress-bar` 是项目里「进度条」的**唯一出口**（算好的 0..100 百分比 +
 *   文案 + aria，消费点几十处）；
 * - 本件是**基元**：`ProgressBar` 内部的 `ProgressTrack` 就来自这里。
 *   它多出来的能力是**组合** —— 标题（`ProgressLabel`）与数值（`ProgressValue`）
 *   是独立的 slot，且 `Progress` 本体自带一条默认轨道。
 *
 * 以前没有 story 的理由是「形态被 `progress-bar` 覆盖」。这一条只对了一半：
 * `ProgressLabel` / `ProgressValue` 两个 slot 在 `progress-bar` 里**看不到**
 * （那边是自绘的文字行），所以这里补的是「组合形态」那一格。
 */
const meta = {
  title: "UI/Progress",
  component: Progress,
  args: { value: 42 },
} satisfies Meta<typeof Progress>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 最简：只给 `value`，`Progress` 会自己补一条默认轨道。 */
export const Default: Story = {
  render: (args) => (
    <div className="w-88">
      <Progress {...args} />
    </div>
  ),
};

/** 组合形态：标题 + 数值 + 轨道。`ProgressValue` 自带 `ml-auto` 与
 *  `tabular-nums` —— 数值逐帧跳动时宽度不会抖，这一条只有并排看才认得出。 */
export const WithLabelAndValue: Story = {
  render: (args) => (
    <div className="flex w-88 flex-col gap-2">
      <Progress {...args}>
        <ProgressLabel>正在解析节点包</ProgressLabel>
        <ProgressValue />
      </Progress>
      <Progress value={100}>
        <ProgressLabel>解压完成</ProgressLabel>
        <ProgressValue />
      </Progress>
    </div>
  ),
};

/** 自定义轨道与填充：`ProgressTrack` / `ProgressIndicator` 都能单独上 class
 *  —— 这也正是 `progress-bar` 内部用法（它只换颜色与高度，不换结构）。 */
export const CustomTrack: Story = {
  render: () => (
    <div className="flex w-88 flex-col gap-4">
      <Progress value={68}>
        <ProgressLabel>默认（h-1 bg-muted）</ProgressLabel>
        <ProgressTrack className="h-2" />
      </Progress>
      <Progress value={68}>
        <ProgressLabel>加粗 + 语义色</ProgressLabel>
        <ProgressTrack className="h-3">
          <ProgressIndicator className="bg-success" />
        </ProgressTrack>
      </Progress>
    </div>
  ),
};

/** 两档极端：`0` 是空条、`100` 是满条。base-ui 会把越界的值夹回 0..100。 */
export const Bounds: Story = {
  render: () => (
    <div className="flex w-88 flex-col gap-4">
      {[0, 100, -10, 130].map((value) => (
        <Progress key={value} value={value}>
          <ProgressLabel>value={value}</ProgressLabel>
          <ProgressValue />
        </Progress>
      ))}
    </div>
  ),
};
