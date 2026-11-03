import type { Meta, StoryObj } from "@storybook/nextjs";

import { Slider } from "~/components/ui/slider";

/**
 * `ui/slider` 是 base-ui 的多把手原语：`value` 是数组，长度即把手数（1 单值 / 2 区间）。单值滑块的唯一入口是
 * `ui/range-slider`（数组包成 number）；本件是它的底座，也是「区间」唯一能写的地方。底座自带 `role="slider"`、
 * aria 值属性与键盘操作 —— 这是换掉原生 `<input type=range>` 的原因（见 `range-slider.tsx` 文件头）。
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
      <Slider {...args} defaultValue={[42]} max={100} min={0} step={1} />
    </div>
  ),
};

/** 区间：长度 2 的数组就是两个把手（时间轴裁切这类场景用这一档）。把手间距过小时会挤在一起 —— 这一条只有画出来
 *  才知道该给多少 `minStepsBetweenValues`。 */
export const Range: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-6">
      <Slider defaultValue={[20, 80]} max={100} min={0} step={1} />
      <Slider defaultValue={[46, 54]} max={100} min={0} step={1} />
    </div>
  ),
};

/** 离散档位：`step` 决定拖拽能不能停在中间 —— 给 10 之后停在 0/10/20…，
 *  与浮点 step 的手感差别很大。 */
export const Stepped: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-6">
      <Slider defaultValue={[30]} max={100} min={0} step={10} />
      <Slider defaultValue={[30]} max={100} min={0} step={1} />
    </div>
  ),
};

/** 禁用：`disabled` 时把手不可拖、键盘也不响应，且样式降为半透明。 */
export const Disabled: Story = {
  render: () => (
    <div className="w-80">
      <Slider defaultValue={[60]} disabled max={100} min={0} />
    </div>
  ),
};
