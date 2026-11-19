import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { CanvasRecenterButton } from "~/components/studio/canvas/CanvasRecenterButton";
import { CanvasSettingsButton } from "~/components/studio/canvas/CanvasSettingsButton";

/**
 * 「重新居中」按钮 story — 纯 props（只有 `onClick`），只动视口不改数据。
 * 位置契约：本按钮 `top-3`、正下方 `CanvasSettingsButton` `top-12`，两处定位类须一起改；
 * story 把两件摆成真机上下关系，顺序/间距被改掉时一眼可见。
 */
const meta = {
  title: "Studio/CanvasRecenterButton",
  component: CanvasRecenterButton,
  args: { onClick: () => undefined },
} satisfies Meta<typeof CanvasRecenterButton>;

export default meta;

type Story = StoryObj<typeof meta>;

function CanvasShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-canvas-deep border-border-strong relative h-56 w-lg overflow-hidden rounded-xl border">
      {children}
    </div>
  );
}

/** 真机位置：右上角。 */
export const Default: Story = {
  render: (args) => (
    <CanvasShell>
      <CanvasRecenterButton {...args} />
    </CanvasShell>
  ),
};

/**
 * 位置契约现场：摆的是真 `CanvasSettingsButton`（复刻不会跟着漂移报错），
 * 居中的 `top-3`、设置的 `top-12` 一上一下；只摆一件则看不出间距被改掉。
 */
export const PositionContractWithSettings: Story = {
  render: (args) => (
    <CanvasShell>
      <CanvasRecenterButton {...args} />
      <CanvasSettingsButton hasOverrides onClick={() => undefined} />
      <p className="text-ink-faint absolute bottom-2 left-3 font-mono text-[11px]">
        契约：居中 top-3 · 设置 top-12（相对定位容器即画布）
      </p>
    </CanvasShell>
  ),
};
