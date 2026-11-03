import type { Meta, StoryObj } from "@storybook/nextjs";
import { useState } from "react";

import { SeedAdvancedField } from "~/components/workshop/SeedAdvancedField";

/**
 * 工坊生成表单的「高级 · 种子」控件（Phase 8 · P8-1c）。纯 props，无运行期依赖。值得看的是两件只有真交互才看得见的事：**空串与数字是两种语义**
 *（空 = 每次自动取新 seed，数字 = pin 住复现同一张图，两档并排摆）；**折叠默认收起**（刻意，种子是高级输入）。输入用官方 `Input`（P68）、折叠用官方 `Disclosure`（P10）。
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
function InteractiveSeed({ initial, disabled }: { disabled?: boolean; initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="flex w-72 flex-col gap-2">
      <SeedAdvancedField disabled={disabled} onChange={setValue} value={value} />
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
  render: () => <InteractiveSeed disabled initial="" />,
};
