import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { MultiModeSelect } from "~/components/ui/multi-mode-select";

/**
 * `MultiModeSelect` 是工作流卡片右上角的多选 chip（主 chip 按默认模式着色 + `+N` 占位），点任一个打开同一多选 popover。它不是 Combobox 的包装：draft / apply 事务（取消不改动，保存才 `onChange`）、`defaultMode` 指针（默认项被取消勾选时回退 `arr[0]`）与分类页签三条复合语义撑不住。
 * 故事看点即这三条约束：取消丢弃草稿、保存后颜色跟随、默认指针始终 `defaultMode ⊆ modes`。
 */
const meta = {
  title: "UI/MultiModeSelect",
  component: MultiModeSelect,
  args: { modes: ["T2I"], defaultMode: "T2I", onChange: () => undefined },
} satisfies Meta<typeof MultiModeSelect>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 受控包装：chip 的 `modes` / `defaultMode` 住在调用处（工作流卡片）。 */
function Demo({
  initialModes,
  initialDefault,
  disabled,
  hideExtraBadge,
}: {
  disabled?: boolean;
  hideExtraBadge?: boolean;
  initialDefault: string;
  initialModes: Array<string>;
}) {
  const [modes, setModes] = useState(initialModes);
  const [defaultMode, setDefaultMode] = useState(initialDefault);
  return (
    <div className="flex w-120 flex-col gap-3">
      <div className="flex items-center gap-3 rounded-lg border p-3">
        <span className="text-sm font-medium">角色一致性 · 三视图</span>
        <MultiModeSelect
          defaultMode={defaultMode}
          disabled={disabled}
          hideExtraBadge={hideExtraBadge}
          modes={modes}
          onChange={(next, nextDefault) => {
            setModes(next);
            setDefaultMode(nextDefault);
          }}
        />
      </div>
      <pre className="rounded-lg border p-3 font-mono text-xs">
        {JSON.stringify({ modes, defaultMode }, null, 2)}
      </pre>
      <p className="text-ink-muted text-xs">
        点开 chip：勾几个再点「取消」，上面这块不会变（草稿被丢弃）； 点「保存」才会提交。
      </p>
    </div>
  );
}

/** 单个模式：不出现 `+N` 徽标。 */
export const SingleMode: Story = {
  render: () => <Demo initialDefault="T2I" initialModes={["T2I"]} />,
};

/** 多个模式：chip 主色按**默认模式**的分类给，附加模式折成 `+N` 徽标
 *  —— 主 chip 与徽标并排的形态只有这一档看得到。 */
export const MultipleModes: Story = {
  render: () => <Demo initialDefault="I2V" initialModes={["T2I", "I2I", "I2V", "T2V"]} />,
};

/** `hideExtraBadge`：调用处（如详情页）自己把全部模式列在上方时，`+N`
 *  就成了冗余 —— popover 仍可从主 chip 打开，只是徽标不画。 */
export const HideExtraBadge: Story = {
  render: () => <Demo hideExtraBadge initialDefault="T2I" initialModes={["T2I", "I2I", "I2V"]} />,
};

/** 三种分类的主色：chip 主色按**默认模式所属分类**取语义 token
 *  （image→primary / video→info / audio→warning）—— 三档并排才看得出
 *  「同一件事有三种色」。 */
export const DefaultModeAccent: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Demo initialDefault="T2I" initialModes={["T2I", "I2I"]} />
      <Demo initialDefault="I2V" initialModes={["I2V", "T2I"]} />
      <Demo initialDefault="T2A" initialModes={["T2A", "T2I"]} />
    </div>
  ),
};

/** 禁用：工作流正在运行时不能改模式 —— chip 不可点、也不出 popover。 */
export const Disabled: Story = {
  render: () => <Demo disabled initialDefault="T2I" initialModes={["T2I", "I2I"]} />,
};
