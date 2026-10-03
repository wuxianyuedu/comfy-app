import React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";

import { RangeSlider } from "~/components/ui/range-slider";

/**
 * `RangeSlider` 是**项目里单值滑块的唯一入口**（`ui/slider` 的薄封装）。
 *
 * 它的存在不是「再包一层」：`ui/slider` 是 base-ui 的**多把手**原语，
 * `value` 始终是数组、`onValueChange` 也回数组 —— 项目里两处消费点
 * （`TrainingStudio` 的 4 个参数、`WorkflowCanvasSettings` 的 SliderRow）
 * 用的都是**单值 + number 回调**。本件把这一层差异收干净，
 * 于是调用处不必各自写 `value={[v]}` / 从数组里淘第一个。
 *
 * 受控组件，story 里自己持一份 state。
 *
 * 与 `ui/number-field` 的分工：想**精确输入**用后者，想**大致瞄一眼**用本件。
 */
const meta = {
  title: "UI/RangeSlider",
  component: RangeSlider,
  args: { value: 0.5, min: 0, max: 1, onChange: () => void 0 },
} satisfies Meta<typeof RangeSlider>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 受控包装：story 自己持一份 state 才看得出拖动效果。 */
function Demo(props: {
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const [value, setValue] = React.useState(props.value);
  return (
    <div className="flex w-80 items-center gap-3">
      <RangeSlider
        value={value}
        onChange={setValue}
        min={props.min}
        max={props.max}
        step={props.step}
        disabled={props.disabled}
        aria-label={props["aria-label"]}
      />
      <span className="text-ink-muted w-12 shrink-0 font-mono text-xs tabular-nums">
        {value}
      </span>
    </div>
  );
}

export const Default: Story = {
  render: () => (
    <Demo value={0.5} min={0} max={1} step={0.01} aria-label="去噪强度" />
  ),
};

/** 三档量纲并列：0..1 的浮点（`step=0.01`）/ 1..150 的整数（步数）/
 *  512..2048 的大区间（边长）—— `step` 决定的不是「能拖多细」而是
 *  「停在哪」，三档手感差别很大。 */
export const Steps: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <Demo value={0.75} min={0} max={1} step={0.01} aria-label="强度" />
      <Demo value={24} min={1} max={150} step={1} aria-label="步数" />
      <Demo
        value={1024}
        min={512}
        max={2048}
        step={64}
        aria-label="边长（64 的倍数）"
      />
    </div>
  ),
};

/** 两档端点：拖到最左 / 最右 —— 这是唯一能看出「把手会不会被轨道裁掉」
 *  的位置（base-ui 的 thumb 是绝对定位的）。 */
export const Bounds: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <Demo value={0} min={0} max={100} step={1} aria-label="最小值" />
      <Demo value={100} min={0} max={100} step={1} aria-label="最大值" />
    </div>
  ),
};

/** 禁用：`disabled` 时把手不可拖、键盘也不响应（`aria-disabled`）。 */
export const Disabled: Story = {
  render: () => (
    <Demo value={42} min={0} max={100} disabled aria-label="被锁定的参数" />
  ),
};
