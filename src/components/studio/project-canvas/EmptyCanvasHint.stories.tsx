import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { EmptyCanvasHint } from "~/components/studio/project-canvas/EmptyCanvasHint";

/**
 * 画布空态覆盖层 —— 纯 props（一个 `loading` 布尔），两档互斥：加载卡 / 空画布引导卡。
 * 两档长得很像但含义相反（一个说「等一下」，一个说「动手吧」），所以要并排看。
 * 组件是 `absolute inset-0`，story 需相对定位容器，否则会跑到页面角落。
 */
const meta = {
  title: "Studio/EmptyCanvasHint",
  component: EmptyCanvasHint,
  args: { loading: false },
  argTypes: { loading: { control: { type: "boolean" } } },
} satisfies Meta<typeof EmptyCanvasHint>;

export default meta;

type Story = StoryObj<typeof meta>;

function CanvasShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-canvas-deep border-border-strong relative h-72 w-xl overflow-hidden rounded-xl border">
      {children}
    </div>
  );
}

/** 水合中：加载卡。 */
export const Loading: Story = {
  args: { loading: true },
  render: (args) => (
    <CanvasShell>
      <EmptyCanvasHint {...args} />
    </CanvasShell>
  ),
};

/** 空画布：右键引导卡（真机上它只占中间，四周的空白是画布本身）。 */
export const Empty: Story = {
  render: (args) => (
    <CanvasShell>
      <EmptyCanvasHint {...args} />
    </CanvasShell>
  ),
};

/** 两档并排：形状相同、含义相反 —— 这是这份 story 存在的理由。 */
export const BothStates: Story = {
  render: () => (
    <div className="flex gap-6">
      <div className="flex flex-col gap-1.5">
        <span className="text-ink-muted font-mono text-[11px]">loading</span>
        <CanvasShell>
          <EmptyCanvasHint loading />
        </CanvasShell>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-ink-muted font-mono text-[11px]">空画布</span>
        <CanvasShell>
          <EmptyCanvasHint loading={false} />
        </CanvasShell>
      </div>
    </div>
  ),
};
