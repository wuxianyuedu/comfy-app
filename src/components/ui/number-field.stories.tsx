import React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";

import { NumberField } from "~/components/ui/number-field";

/**
 * `NumberField` 是 ComfyUI 风的数值步进器（`[—] 值 [+]`），替换原生
 * `<input type="number">`。
 *
 * 它的**核心机制是「草稿态」**，而这件事只有真的敲键盘才看得见：
 * 聚焦期间的击键原样回显在本地 `draft` 里（受控 `value` 的 clamp 回写会把
 * 输入途中的 `0.` / 空串 / 小于 `step` 的值瞬间顶回去 —— 等于没法打字），
 * **失焦或点 ± 才把草稿 clamp 成合法值提交**。可以在画布上试试：把「24」
 * 改成「0.」，它不会立刻被顶回去；失焦后才会变成 `0`。
 *
 * 受控组件在 story 里要自己持一份 state（`onChange` 不接的话交互看不到效果），
 * 所以下面用一层 `Demo` 适配。
 *
 * ## 为什么画布上的组件叫 `NumberFieldWithState`
 *
 * Storybook 的 `component` 字段要的是**真组件**（Args 面板按它的 props 生成
 * 控件），而受控包装只是 story 的手段。两者分开写：`component` 仍指向
 * `NumberField`，渲染时用 `render` 换成带 state 的包装。
 */
const meta = {
  title: "UI/NumberField",
  component: NumberField,
  args: { value: 24, onChange: () => void 0 },
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
