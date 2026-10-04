import type { Meta, StoryObj } from "@storybook/nextjs";

import { CanvasSettingsButton } from "~/components/studio/canvas/CanvasSettingsButton";

/**
 * 画布右上角设置（齿轮）按钮 —— 纯 props（`hasOverrides` + `onClick`）。
 *
 * 它有一个**只有两档并排才看得见**的状态：`hasOverrides` 为真时按钮尾部多一颗
 * 紫色小点（「当前有偏离默认值的偏好」）。单摆一档的话，那颗小点要么看不出在、
 * 要么看不出不在 —— 而它正是这个组件的全部差异（不必先打开面板就知道定制在生效）。
 *
 * 位置契约同 `CanvasRecenterButton`：本按钮在 `top-12`、正上方那颗在 `top-3`，
 * 两处的定位类要一起改。
 */
const meta = {
  title: "Studio/CanvasSettingsButton",
  component: CanvasSettingsButton,
  args: { hasOverrides: false, onClick: () => undefined },
  argTypes: { hasOverrides: { control: { type: "boolean" } } },
} satisfies Meta<typeof CanvasSettingsButton>;

export default meta;

type Story = StoryObj<typeof meta>;

function CanvasShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-canvas-deep border-border-strong relative h-44 w-[32rem] overflow-hidden rounded-xl border">
      {children}
    </div>
  );
}

/** 全部偏好都是默认值：按钮上**没有**那颗小点。 */
export const NoOverrides: Story = {
  render: (args) => (
    <CanvasShell>
      <CanvasSettingsButton {...args} />
    </CanvasShell>
  ),
};

/** 有偏离默认值的偏好：尾部那颗紫色小点出现（这就是这组 story 的对照面）。 */
export const HasOverrides: Story = {
  args: { hasOverrides: true },
  render: (args) => (
    <CanvasShell>
      <CanvasSettingsButton {...args} />
    </CanvasShell>
  ),
};

/** 两档并排：唯一能一眼看出「小点在不在」的摆法。 */
export const BothStates: Story = {
  render: () => (
    <div className="flex gap-6">
      <div className="flex flex-col gap-1.5">
        <span className="text-ink-muted font-mono text-[11px]">
          hasOverrides = false
        </span>
        <CanvasShell>
          <CanvasSettingsButton
            hasOverrides={false}
            onClick={() => undefined}
          />
        </CanvasShell>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-ink-muted font-mono text-[11px]">
          hasOverrides = true
        </span>
        <CanvasShell>
          <CanvasSettingsButton hasOverrides onClick={() => undefined} />
        </CanvasShell>
      </div>
    </div>
  ),
};
