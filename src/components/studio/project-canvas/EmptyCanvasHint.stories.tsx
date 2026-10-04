import type { Meta, StoryObj } from "@storybook/nextjs";

import { EmptyCanvasHint } from "~/components/studio/project-canvas/EmptyCanvasHint";

/**
 * 画布空态覆盖层 —— 纯 props（一个 `loading` 布尔），两档互斥：
 *
 *   · `loading = true` → 初始项目水合期间的加载卡（`Spinner` + 「加载中…」）；
 *   · `loading = false` → 画布确实为空时的引导卡（右键开始创建节点）。
 *
 * 两档值得并排看，因为它们**长得很像**（同一个居中卡片的形状），而含义完全不同：
 * 一个说「等一下」，一个说「动手吧」。用户在这两个状态下的下一步动作是相反的，
 * 只改文案不改形状时很容易把两者弄混 —— 这正是要摆在一屏里的理由。
 *
 * 组件是 `absolute inset-0`，真机上盖在画布上；所以 story 给一个**相对定位的容器**
 * 当画布替代品，否则它会跑到页面角落（那是这些 story 唯一需要额外提供的东西）。
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
    <div className="bg-canvas-deep border-border-strong relative h-72 w-[36rem] overflow-hidden rounded-xl border">
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
