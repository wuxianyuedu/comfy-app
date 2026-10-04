import type { Meta, StoryObj } from "@storybook/nextjs";

import { Slider } from "~/components/ui/slider";

/**
 * `ui/slider` 是 base-ui 的 Slider（**多把手**原语）：`value` 始终是一个
 * 数组，长度就是把手数 —— 长度 1 是单值滑块，长度 2 就是区间滑块。
 *
 * 项目里单值滑块的**唯一入口**是 `ui/range-slider`（它把数组包成 number，
 * 见那件的 story）；本件是那个出口的底座，也是「区间」这一档唯一能写的
 * 地方（`range-slider` 表达不了两个值）。
 *
 * 底座自带 `role="slider"` + `aria-valuenow/min/max` + 键盘
 * ←/→ / PageUp/PageDown / Home/End —— 这些是它比原生 `<input type=range>`
 * 强的地方，也是本项目换掉原生实现的原因（见 `range-slider.tsx` 文件头）。
 */
const meta = {
  title: "UI/Slider",
  component: Slider,
} satisfies Meta<typeof Slider>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 单把手：`value` 是长度 1 的数组。 */
export const Single: Story = {
  render: (args) => (
    <div className="w-80">
      <Slider {...args} defaultValue={[42]} min={0} max={100} step={1} />
    </div>
  ),
};

/** 区间：长度 2 的数组就是两个把手（时间轴裁切这类场景用这一档）。把手间距过小时会挤在一起 —— 这一条只有画出来
 *  才知道该给多少 `minStepsBetweenValues`。 */
export const Range: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-6">
      <Slider defaultValue={[20, 80]} min={0} max={100} step={1} />
      <Slider defaultValue={[46, 54]} min={0} max={100} step={1} />
    </div>
  ),
};

/** 离散档位：`step` 决定拖拽能不能停在中间 —— 给 10 之后停在 0/10/20…，
 *  与浮点 step 的手感差别很大。 */
export const Stepped: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-6">
      <Slider defaultValue={[30]} min={0} max={100} step={10} />
      <Slider defaultValue={[30]} min={0} max={100} step={1} />
    </div>
  ),
};

/** 禁用：`disabled` 时把手不可拖、键盘也不响应，且样式降为半透明。 */
export const Disabled: Story = {
  render: () => (
    <div className="w-80">
      <Slider defaultValue={[60]} min={0} max={100} disabled />
    </div>
  ),
};
