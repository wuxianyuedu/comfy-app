import type { Meta, StoryObj } from "@storybook/nextjs";

import { Kbd, KbdGroup } from "~/components/ui/kbd";

/**
 * `Kbd` / `KbdGroup` 没有变体轴：键帽的尺寸由基类固定（`h-5 min-w-5`），
 * 组合键靠 `KbdGroup` 的 `inline-flex gap-1` 排列。
 */
const meta = {
  title: "UI/Kbd",
  component: Kbd,
  args: { children: "K" },
} satisfies Meta<typeof Kbd>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** 单键 / 组合键 / 多字形（`⌘` 与 `Enter` 这类非单字符的键名自动撑宽 `min-w-5`）。 */
export const Keys: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <Kbd>A</Kbd>
        <Kbd>1</Kbd>
        <Kbd>Esc</Kbd>
        <Kbd>⌘</Kbd>
      </div>
      <div className="flex items-center gap-4">
        <KbdGroup>
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
        <KbdGroup>
          <Kbd>Ctrl</Kbd>
          <Kbd>Shift</Kbd>
          <Kbd>P</Kbd>
        </KbdGroup>
      </div>
    </div>
  ),
};

/** 夹在一句说明里：这是它最常见的落点（命令面板 / 工具提示的快捷键行）。 */
export const Inline: Story = {
  render: () => (
    <p className="text-ink-muted flex items-center gap-1.5 text-sm">
      打开命令面板
      <KbdGroup>
        <Kbd>Ctrl</Kbd>
        <Kbd>K</Kbd>
      </KbdGroup>
    </p>
  ),
};
