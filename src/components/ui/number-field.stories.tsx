import React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";

import { NumberField } from "~/components/ui/number-field";

/**
 * `NumberField` 是 ComfyUI 风的数值步进器（`[—] 值 [+]`），替换原生 `<input type="number">`。核心是草稿态：聚焦期间击键原样回显在本地 `draft`（受控 clamp 回写会顶掉输入中的 `0.` / 空串），失焦或点 ± 才 clamp 提交。
 * 可在画布上把「24」改成「0.」验证。受控组件 story 里自己持 state，故画布组件名是 `NumberFieldWithState`（Storybook 的 `component` 仍指向真组件，`render` 换成带 state 的包装）。
 */
const meta = {
  title: "UI/NumberField",
  component: NumberField,
  args: { value: 24, onChange: () => undefined },
} satisfies Meta<typeof NumberField>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 受控包装：story 自己持一份 state，交互才看得出「失焦才提交」。 */
function Demo(props: {
  decimalPlaces?: number;
  disabled?: boolean;
  max?: number;
  min?: number;
  step?: number;
  value: number;
}) {
  const [value, setValue] = React.useState(props.value);
  return (
    <NumberField
      decimalPlaces={props.decimalPlaces}
      disabled={props.disabled}
      max={props.max}
      min={props.min}
      onChange={setValue}
      step={props.step}
      value={value}
    />
  );
}

export const Default: Story = {
  render: () => <Demo max={100} min={0} step={1} value={24} />,
};

/** 三档边界并列：常规（整数步进）/ `decimalPlaces` 的小数（0.05 步进的
 *  强度值）/ 窄区间（`min`=`max` 很近，± 按钮很快到顶、箭头变禁用）。 */
export const Variants: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-5">
      <Demo max={100} min={0} step={1} value={24} />
      <Demo decimalPlaces={2} max={1} min={0} step={0.05} value={0.75} />
      <Demo max={12} min={6} step={1} value={8} />
    </div>
  ),
};

/** 边界值：`value` 正好等于 `min` / `max` 时，对应的 ± 按钮应该是禁用态
 *  —— 这一档只在两个端点处看得到，中间值看不出来。 */
export const AtBounds: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-5">
      <Demo max={100} min={0} step={1} value={0} />
      <Demo max={100} min={0} step={1} value={100} />
    </div>
  ),
};

/** 禁用：`disabled` 时 `±` 与输入框一起失效并降透明度 —— 参数被工作流
 *  锁定时（`WorkflowCanvasSettings` 的只读字段）就是这个形态。 */
export const Disabled: Story = {
  render: () => <Demo disabled max={100} min={0} value={24} />,
};
