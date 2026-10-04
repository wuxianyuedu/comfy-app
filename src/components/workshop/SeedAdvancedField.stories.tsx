import type { Meta, StoryObj } from "@storybook/nextjs";
import { useState } from "react";

import { SeedAdvancedField } from "~/components/workshop/SeedAdvancedField";

/**
 * 工坊生成表单的「高级 · 种子」控件（Phase 8 · P8-1c）。
 *
 * 纯 props：`value` 是一段**原始字符串**（空串 = 自动随机），没有 tRPC、
 * 没有运行期依赖。它值得有 story 的地方在两件**只有真交互才看得见**的事：
 *
 *   · **空串与数字是两种语义，不是「没填」与「填了」** —— 空串是「每次生成自动取
 *     一个新 seed」，填数字是「pin 住这个 seed 复现同一张图」。所以下面把这两档
 *     并排放，画布上能同时读到输入框里是空的还是有值；
 *   · **折叠默认收起**：控件住在 `Disclosure` 里，默认状态下画布上只有「高级」两个字
 *     —— 这是刻意的（种子是高级输入，不该占常用区），story 里把展开与收起都摆出来。
 *
 * 输入用官方 `Input`（P68）、折叠用官方 `Disclosure`（P10），本件不手搓。
 */
const meta = {
  title: "Workshop/SeedAdvancedField",
  component: SeedAdvancedField,
  args: { value: "", onChange: () => undefined },
  argTypes: {
    value: { control: { type: "text" } },
    disabled: { control: { type: "boolean" } },
  },
} satisfies Meta<typeof SeedAdvancedField>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * 受控适配：`value` 与「随机」按钮都要真发生（点随机应清空），
 * 所以 story 自己持一份状态 —— 这与真机上的控制方式一致。
 */
function InteractiveSeed({
  initial,
  disabled,
}: {
  initial: string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className="flex w-72 flex-col gap-2">
      <SeedAdvancedField
        value={value}
        onChange={setValue}
        disabled={disabled}
      />
      <p className="text-ink-muted font-mono text-[11px]">
        value = {JSON.stringify(value)}
        {value === "" ? "  ← 自动随机" : "  ← 已 pin"}
      </p>
    </div>
  );
}

/** 空串：每次生成自动随机（placeholder 就是这句）。展开后点「随机」仍是空串。 */
export const AutoRandom: Story = {
  render: () => <InteractiveSeed initial="" />,
};

/** 已 pin 一个固定 seed：复现同一张图。 */
export const Pinned: Story = {
  render: () => <InteractiveSeed initial="486920135724881" />,
};

/** 禁用态（生成进行中）：输入框与「随机」按钮都不可点。 */
export const Disabled: Story = {
  render: () => <InteractiveSeed initial="" disabled />,
};
