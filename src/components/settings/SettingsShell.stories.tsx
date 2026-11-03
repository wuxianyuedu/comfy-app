import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";

import { SETTINGS_SECTIONS, type Section } from "~/app/(main)/settings/hooks/use-settings-page";
import { SettingsShell } from "./SettingsShell";

/**
 * `SettingsShell` 是设置页的共享外壳：标题行 + 左侧分区导航树 + **一根**内容滚动条。
 * story 要验两件源码里看不出来的事：① 导航树的两层看得出层级（ISSUE #1694）；② 一页到底、
 * 滚动时高亮跟着走（ISSUE #1722，`Long` 刻意把每节撑高）。外壳不持状态，用最小容器接起来。
 */
/** 三态 story 不需要真实的选中回调 —— 显式空函数，别写内联空箭头（lint 拦下）。 */
function noop() {
  /* 有意为空：story 里导航没有可切的正文。 */
}

const meta: Meta<typeof SettingsShell> = {
  title: "Settings/SettingsShell",
  component: SettingsShell,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof SettingsShell>;

/** 每个分区给一段占位正文 —— 只为了让锚点有实体。 */
function sections(pad: string) {
  /* SAFETY: 类型断言已复核 */
  return Object.fromEntries(
    SETTINGS_SECTIONS.map((item) => [
      item.id,
      <p className={`text-ink text-sm ${pad}`} key={item.id}>
        这一节的正文（<code className="font-mono">{item.id}</code>）
      </p>,
    ]),
  ) as Record<Section, React.ReactNode>;
}

function Demo({ initial = "llmLocal", pad = "" }: { initial?: Section; pad?: string }) {
  const [section, setSection] = useState<Section>(initial);
  return <SettingsShell onSelect={setSection} section={section} sections={sections(pad)} />;
}

/** 默认选中「本地模型」—— 高亮落在树的第一段第一条上，各节都很短（一屏装得下）。 */
export const Default: Story = { render: () => <Demo /> };

/** 切到别的段：验证高亮会跟着走，且每段各自带一条缩进引导线。 */
export const AnotherSection: Story = {
  render: () => <Demo initial="backup" />,
};

/**
 * 长内容：每节撑到高于一屏 —— 滚动时点导航跳转、并观察高亮随滚动变化
 *（这是 ISSUE #1722 的原始诉求：「滚动条可以从头滚动到尾，左侧选中项跟随滚动变化」）。
 */
export const Long: Story = {
  render: () => <Demo pad="min-h-[70vh]" />,
};

/** 三态（加载 / 失败）：给 `fallback` 时导航仍在、右侧换成整块占位。 */
export const LoadingFallback: Story = {
  render: () => (
    <SettingsShell
      fallback={<p className="text-ink-muted text-sm">正在读取设置…（三态占位）</p>}
      onSelect={noop}
      section="llmLocal"
    />
  ),
};
