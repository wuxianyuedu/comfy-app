import type { Meta, StoryObj } from "@storybook/nextjs";
import { useState } from "react";

import {
  MEGAPIXEL_MAX,
  MEGAPIXEL_MIN,
  MEGAPIXEL_STEP,
  MegapixelStepper,
} from "~/components/studio/workflow-form/MegapixelStepper";

/** 百万像素自由值步进器 story —— 「档位之外还能自己填」那一条。纯 props（value/onChange/disabled），
 * 上下限与步进量必须引 `MEGAPIXEL_MIN/MAX/STEP`，不得手抄（改常量时 story 会显示旧口径）。
 * 百万像素在端口上是连续量（FLOAT），1M/2M/4M 只是常用档位；工坊尺寸选择器与工作流表单共用这一个实现，
 * 两处各写一份必在步进量/上限/小数位分叉。data-testid="megapixel-stepper" 用于与宽/高 NumberField 区分
 *（它们的步进按钮 title 相同，按 title 查会命中三个）。 */
const meta = {
  title: "Studio/MegapixelStepper",
  component: MegapixelStepper,
  args: { value: 1, onChange: () => undefined },
  argTypes: {
    value: { control: { type: "number" } },
    disabled: { control: { type: "boolean" } },
  },
} satisfies Meta<typeof MegapixelStepper>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 受控适配：步进要真发生（点 +/- 应改数），所以 story 自己持值。 */
function LiveStepper({ initial, ...rest }: { disabled?: boolean; initial: number }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="flex w-64 flex-col gap-2">
      <MegapixelStepper {...rest} onChange={setValue} value={value} />
      <p className="text-ink-muted font-mono text-[11px]">value = {String(value)} M</p>
    </div>
  );
}

/** 常用档位 1M。 */
export const Default: Story = { render: () => <LiveStepper initial={1} /> };

/**
 * 档位之外的自定义值 2.5M —— 正是这个控件存在的理由（档位按钮给不了 2.5）。
 * 显示小数位与步进量同档（1 位），长尾 1.024 不会被摆出来撑开输入框。
 */
export const CustomValue: Story = {
  render: () => <LiveStepper initial={2.5} />,
};

/**
 * 三档并排：下限 / 步进 / 上限。边界值都从 export 取，所以这三个数字
 * 与真机上会 clamp 到的值**同源**。
 */
export const Boundaries: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <p className="text-ink-muted font-mono text-[11px]">
        min={String(MEGAPIXEL_MIN)} step={String(MEGAPIXEL_STEP)} max=
        {String(MEGAPIXEL_MAX)}（上限由 MAX_SIZE 的平方反推）
      </p>
      <div className="flex flex-wrap gap-6">
        <LiveStepper initial={MEGAPIXEL_MIN} />
        <LiveStepper initial={MEGAPIXEL_MIN + MEGAPIXEL_STEP} />
        <LiveStepper initial={MEGAPIXEL_MAX} />
      </div>
    </div>
  ),
};

/** 禁用态（尺寸由场景预设接管时）。 */
export const Disabled: Story = {
  render: () => <LiveStepper disabled initial={2} />,
};
