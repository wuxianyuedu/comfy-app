import React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { StepperInput } from "~/components/ui/stepper-input";

/**
 * `StepperInput` 是悬浮式数字步进输入框（ISSUE #3495）：上下箭头悬浮在输入框
 * 内部右侧，悬停 / 聚焦时浮现，点击按 `step` 增减并 clamp 进 [min, max]。
 * 替换原生 `<input type="number">` 的 spinner（浅色主题下白底压在字段上）。
 * 受控组件 story 里自己持 state，画布组件名是 `StepperInputWithState`
 * （Storybook 的 `component` 仍指向真组件，`render` 换成带 state 的包装）。
 */
const meta = {
  title: "UI/StepperInput",
  component: StepperInput,
  args: { value: "0.65", onValueChange: () => undefined },
} satisfies Meta<typeof StepperInput>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 受控包装：story 自己持一份 state，点箭头才看得出值在走。 */
function Demo(props: { max?: number; min?: number; step?: number; value: string }) {
  const [value, setValue] = React.useState(props.value);
  return (
    <StepperInput
      ariaLabel="温度"
      className="w-24"
      inputClassName="border-border bg-surface-2 text-ink focus-visible:border-primary h-auto rounded-lg py-1.5 pl-2 text-right text-sm"
      max={props.max}
      min={props.min}
      onCommit={() => undefined}
      onValueChange={setValue}
      step={props.step}
      value={value}
    />
  );
}

export const Default: Story = {
  render: () => <Demo max={2} min={0} step={0.05} value="0.65" />,
};

/** 三档边界并列：常规值 / 已到下限（再点减少仍停在 0）/ 已到上限 / 空值
 *  （点增加从下限起步）。箭头本身悬浮在框内，悬停输入框才浮现。 */
export const Variants: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-5">
      <Demo max={2} min={0} step={0.05} value="0.65" />
      <Demo max={2} min={0} step={0.05} value="0" />
      <Demo max={2} min={0} step={0.05} value="2" />
      <Demo max={2} min={0} step={0.05} value="" />
    </div>
  ),
};
