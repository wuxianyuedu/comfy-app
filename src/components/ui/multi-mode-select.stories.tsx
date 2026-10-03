import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";

import { MultiModeSelect } from "~/components/ui/multi-mode-select";

/**
 * `MultiModeSelect` 是工作流卡片右上角的**多选 chip**：主 chip（按默认模式的
 * 分类着色）+ `+N` 附加模式占位，点任一个打开同一个多选 popover。
 *
 * ## 它为什么是一份单独的复合件（而不是 Combobox 的包装）
 *
 * 这一点值得写在 story 里，因为从形状看它与「搜索 + 多选」的 Combobox 很像 ——
 * 但本件有**三条 Combobox 撑不住的复合语义**（`multi-mode-select.tsx` 文件头
 * 逐条论证过，那是「已评估保留」的结论、与磁盘上是否装有 combobox 无关）：
 *
 * 1. **draft / apply 事务**：面板内起一份草稿，只有点「保存」才 `onChange`
 *    回父层；点「取消」直接关、不改动。Combobox 是「即时选中即回调」的单向流，
 *    要实现草稿就得在外层再手写一份 —— 那时其实已经**不是复用、而是二次包装**。
 * 2. **`defaultMode` 指针**：`modes` 里额外标一位「哪个是默认」，显示在 chip
 *    主色上；保存时若默认项被取消勾选，会回退到 `arr[0]` 保证
 *    `defaultMode ⊆ modes`。
 * 3. **分类页签**（图像 / 视频 / 音频）：面板顶部切段，每段独立展示该分类的
 *    候选 —— Combobox 是单一搜索列表，没有页签维度。
 *
 * ## story 的看点在「事务」与「约束」
 *
 * - 打开面板、勾几个、点**取消** → chip 与 props 完全没变（草稿被丢弃）；
 * - 打开面板、勾几个、点**保存** → chip 更新、且默认模式那张分类色跟着换；
 * - 把「默认模式」取消勾选再保存 → 默认回退到剩余项之首。
 */
const meta = {
  title: "UI/MultiModeSelect",
  component: MultiModeSelect,
  args: { modes: ["T2I"], defaultMode: "T2I", onChange: () => void 0 },
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
  initialModes: string[];
  initialDefault: string;
  disabled?: boolean;
  hideExtraBadge?: boolean;
}) {
  const [modes, setModes] = useState(initialModes);
  const [defaultMode, setDefaultMode] = useState(initialDefault);
  return (
    <div className="flex w-[30rem] flex-col gap-3">
      <div className="flex items-center gap-3 rounded-lg border p-3">
        <span className="text-sm font-medium">角色一致性 · 三视图</span>
        <MultiModeSelect
          modes={modes}
          defaultMode={defaultMode}
          onChange={(next, nextDefault) => {
            setModes(next);
            setDefaultMode(nextDefault);
          }}
          disabled={disabled}
          hideExtraBadge={hideExtraBadge}
        />
      </div>
      <pre className="rounded-lg border p-3 font-mono text-xs">
        {JSON.stringify({ modes, defaultMode }, null, 2)}
      </pre>
      <p className="text-ink-muted text-xs">
        点开 chip：勾几个再点「取消」，上面这块不会变（草稿被丢弃）；
        点「保存」才会提交。
      </p>
    </div>
  );
}

/** 单个模式：不出现 `+N` 徽标。 */
export const SingleMode: Story = {
  render: () => <Demo initialModes={["T2I"]} initialDefault="T2I" />,
};

/** 多个模式：chip 主色按**默认模式**的分类给，附加模式折成 `+N` 徽标
 *  —— 主 chip 与徽标并排的形态只有这一档看得到。 */
export const MultipleModes: Story = {
  render: () => (
    <Demo initialModes={["T2I", "I2I", "I2V", "T2V"]} initialDefault="I2V" />
  ),
};

/** `hideExtraBadge`：调用处（如详情页）自己把全部模式列在上方时，`+N`
 *  就成了冗余 —— popover 仍可从主 chip 打开，只是徽标不画。 */
export const HideExtraBadge: Story = {
  render: () => (
    <Demo
      initialModes={["T2I", "I2I", "I2V"]}
      initialDefault="T2I"
      hideExtraBadge
    />
  ),
};

/** 三种分类的主色：chip 主色按**默认模式所属分类**取语义 token
 *  （image→primary / video→info / audio→warning）—— 三档并排才看得出
 *  「同一件事有三种色」。 */
export const DefaultModeAccent: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Demo initialModes={["T2I", "I2I"]} initialDefault="T2I" />
      <Demo initialModes={["I2V", "T2I"]} initialDefault="I2V" />
      <Demo initialModes={["T2A", "T2I"]} initialDefault="T2A" />
    </div>
  ),
};

/** 禁用：工作流正在运行时不能改模式 —— chip 不可点、也不出 popover。 */
export const Disabled: Story = {
  render: () => (
    <Demo initialModes={["T2I", "I2I"]} initialDefault="T2I" disabled />
  ),
};
