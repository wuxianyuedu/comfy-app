import type { Meta, StoryObj } from "@storybook/nextjs";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "~/components/ui/resizable";

/**
 * `ui/resizable` 是 `react-resizable-panels` 的薄封装：左中右可拖拽分栏。
 *
 * 形态上有两条只有渲染出来才知道的事：
 * 1. **`ResizablePanelGroup` 自身是 `h-full w-full`** —— 放进一个**没有高度**
 *    的祖先里会塌成 0 高（分栏看得见，内容看不见）。所以 story 都给死高度。
 * 2. **`withHandle` 那一档**：不给时只有一条 1px 的缝（命中区靠 `after:` 扩到
 *    5px），给了才在中间画一根 6×1 的小竖条 —— 后者是「拖这里」的视觉提示。
 *
 * 拖拽 / 折叠 / 键盘调整归底座，story 不重复验那部分。
 */
const meta = {
  title: "UI/Resizable",
  component: ResizablePanelGroup,
} satisfies Meta<typeof ResizablePanelGroup>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 左右两栏 + 带把手：最常见的形态（左树 + 右内容区）。 */
export const Horizontal: Story = {
  render: () => (
    <ResizablePanelGroup className="h-56 w-[36rem] rounded-lg border">
      <ResizablePanel defaultSize="30" minSize="20">
        <div className="text-ink-muted flex h-full items-center justify-center text-sm">
          左栏（30%）
        </div>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize="70">
        <div className="text-ink-muted flex h-full items-center justify-center text-sm">
          主内容区
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  ),
};

/** 不带把手：只剩 1px 的分缝（命中区仍由 `after:` 撑到 5px）——
 *  与上面那条并排看，才知道 `withHandle` 加的是什么。 */
export const WithoutHandle: Story = {
  render: () => (
    <ResizablePanelGroup className="h-56 w-[36rem] rounded-lg border">
      <ResizablePanel defaultSize="40">
        <div className="text-ink-muted flex h-full items-center justify-center text-sm">
          40%
        </div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize="60">
        <div className="text-ink-muted flex h-full items-center justify-center text-sm">
          60%
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  ),
};

/** 竖向：`orientation="vertical"` 时 handle 的 `aria-orientation` 变成
 *  `horizontal`，缝也从竖线变横线（`aria-[orientation=horizontal]:*` 那一串）
 *  —— 这是同一件组件里最容易写错的一处。 */
export const Vertical: Story = {
  render: () => (
    <ResizablePanelGroup
      orientation="vertical"
      className="h-56 w-[30rem] rounded-lg border"
    >
      <ResizablePanel defaultSize="50">
        <div className="text-ink-muted flex h-full items-center justify-center text-sm">
          上（50%）
        </div>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize="50">
        <div className="text-ink-muted flex h-full items-center justify-center text-sm">
          下（50%）
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  ),
};

/** 三栏：`minSize` 决定拖到哪就停 —— 三条 story 里只有这条能验
 *  「两个把手互相约束」（左栏变大时中栏先被压缩）。 */
export const ThreePanels: Story = {
  render: () => (
    <ResizablePanelGroup className="h-56 w-[36rem] rounded-lg border">
      <ResizablePanel defaultSize="25" minSize="15">
        <div className="text-ink-muted flex h-full items-center justify-center text-sm">
          节点树
        </div>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize="50" minSize={30}>
        <div className="text-ink-muted flex h-full items-center justify-center text-sm">
          画布
        </div>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize="25" minSize="15">
        <div className="text-ink-muted flex h-full items-center justify-center text-sm">
          属性面板
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  ),
};
