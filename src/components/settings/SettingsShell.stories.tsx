import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";

import type { Section } from "~/app/(main)/settings/hooks/use-settings-page";
import { SettingsShell } from "./SettingsShell";

/**
 * `SettingsShell` 是设置页的共享外壳：标题行 + 左侧分区导航树 + 内容滚动区。
 *
 * 这两个 story 存在的理由只有一个 —— **导航树的两层要看得出层级**（ISSUE #1694）：
 * 分组名是父行（弱一档、不可点），分区项是它的子行（缩进 + 引导线、可点）。
 * 横排那版把两者排成同一种词，光看代码分不出「模型」是组、「本地模型」是项；
 * 并排看这两屏（默认选中 + 切到别的分区）能立刻验证父 / 子行与 `aria-current`。
 *
 * 外壳本身不持状态（`section` / `onSelect` 都由调用方给），所以这里用一个最小
 * 容器把它受控的部分接起来，内容区只放一句「当前分区」——真实分区视图会盖住
 * 导航树本身要看的那点高度。
 */
const meta: Meta<typeof SettingsShell> = {
  title: "Settings/SettingsShell",
  component: SettingsShell,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof SettingsShell>;

function Demo({ initial = "llmLocal" }: { initial?: Section }) {
  const [section, setSection] = useState<Section>(initial);
  return (
    <SettingsShell section={section} onSelect={setSection}>
      <p className="text-ink text-sm">
        当前分区：<code className="font-mono">{section}</code>
      </p>
    </SettingsShell>
  );
}

/** 默认选中「本地模型」—— 高亮落在树的第一段第一条上。 */
export const Default: Story = { render: () => <Demo /> };

/** 切到别的段：验证高亮会跟着走，且每段各自带一条缩进引导线。 */
export const AnotherSection: Story = {
  render: () => <Demo initial="backup" />,
};
