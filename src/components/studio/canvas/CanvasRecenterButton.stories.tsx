import type { Meta, StoryObj } from "@storybook/nextjs";

import { CanvasRecenterButton } from "~/components/studio/canvas/CanvasRecenterButton";
import { CanvasSettingsButton } from "~/components/studio/canvas/CanvasSettingsButton";

/**
 * 画布右上角「重新居中」按钮 —— 纯 props（只有 `onClick`），一个不写库的纯视口动作。
 *
 * 它值得有 story 的地方不在长相，而在**位置契约**：本按钮在 `top-3`、正下方
 * `<CanvasSettingsButton>` 在 `top-12`，两处的定位类要一起改。所以下面把两件
 * 摆成真机上的上下位置关系（一块画布替代容器 + 两颗按钮各自的绝对定位），
 * 顺序反了或者间距被改掉时一眼看得出来。
 *
 * 与项目画布的「重置布局」不是同一件事：那个会**改数据**（重排节点），这个只动视口。
 * 文案「只移动视口，不改动节点布局」就是那条差异的出口。
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
    <div className="bg-canvas-deep border-border-strong relative h-56 w-[32rem] overflow-hidden rounded-xl border">
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
 * 与设置按钮的**位置契约**（这里摆的是**真**的 `CanvasSettingsButton`，
 * 不是复刻的按钮 —— 复刻一份等于把「两处的定位类要一起改」这条契约
 * 在 story 里又抄了一遍，而抄的那份不会跟着漂移报错）。：居中的在 `top-3`、设置的在 `top-12`，一上一下。
 * 这里刻意把两件放在同一个容器里 —— 只摆一件的话，间距被改掉是看不出来的
 *（两件各自的 story 都还是「对」的，错的是它们的关系）。
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
