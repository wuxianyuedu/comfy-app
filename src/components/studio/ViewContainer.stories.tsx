import type { Meta, StoryObj } from "@storybook/nextjs";

import {
  DocumentFrame,
  WorkspaceFrame,
} from "~/components/studio/ViewContainer";

/**
 * 视图容器（`ViewContainer`）—— 两种框架形态，各屏按「怎么滚」选一种。
 *
 * 这两件没有数据依赖，但它们**几乎是纯布局**，所以「长得对」这件事在 story 里
 * 特别值得看：一屏用哪个框架决定了整屏会不会出现**双层滚动条**。
 *
 *   · **`DocumentFrame`**：整屏滚动 + 居中窄栏，`width` 三档（`narrow` / `wide` /
 *     `full`）。`backdrop` 挂在**外框**里、是滚动层的兄弟（铺底若塞进 `children`
 *     就成了居中列的第一个子节点，位置语义会变）——所以 story 里给了带 `backdrop`
 *     的那一档，它是唯一能看出那层关系的地方。
 *   · **`WorkspaceFrame`**：吃满父级、**不**产生页面级滚动条（内部怎么分栏、哪一栏
 *     自己滚，是视图的事）。它写死 `overflow-hidden`，于是内部那层才会真的出滚动条
 *     —— 这正是「整屏滚 + 画布也滚」那条历史事故的形状。
 *
 * 各层都是 `<div>` 而不是 `<main>`：外壳的 `SidebarInset` 才是这些屏唯一的
 * `<main>`（语义标签规范），再套一个会破坏地标导航 —— 所以 story 里也不套 `<main>`。
 */
/**
 * 这两件的入参里有 `children`，直接拿组件当 `Meta` 的泛型会让每个 story 都必须
 * 给一份 `children`（而它正是每个 story 要自己摆的东西）。所以口径与
 * `WorkshopStageRail` / `ViewTabStrip` 那几份一致：**声明一份 story 自己的 Args**，
 * `component` 指向一个把 `children` 收进去的适配件。
 */
type StoryArgs = {
  width: NonNullable<React.ComponentProps<typeof DocumentFrame>["width"]>;
};

/** 适配件：`width` 进 Args，正文由各 story 的 `render` 给。 */
function FrameSample({
  width,
  children,
}: StoryArgs & { children?: React.ReactNode }) {
  return <DocumentFrame width={width}>{children}</DocumentFrame>;
}

const meta = {
  title: "Studio/ViewContainer",
  component: FrameSample,
  args: { width: "wide" },
  argTypes: {
    width: { control: { type: "select" }, options: ["narrow", "wide", "full"] },
  },
} satisfies Meta<StoryArgs & { children?: React.ReactNode }>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 假正文：滚动是不是真的发生，得有一段够长的内容才知道。 */
function Body({ rows = 24 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2 p-4">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="bg-surface border-border text-ink-soft rounded-lg border px-3 py-2 text-xs"
        >
          第 {String(i + 1)} 行 —— 内容要高过容器，滚动条才会出现
        </div>
      ))}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-border-strong h-72 w-160 overflow-hidden rounded-xl border">
      {children}
    </div>
  );
}

/** 文档型（宽栏）：整屏滚动，内容装在居中列里。 */
export const DocumentWide: Story = {
  render: (args) => (
    <Shell>
      <FrameSample width={args.width}>
        <Body />
      </FrameSample>
    </Shell>
  ),
};

/** 窄栏：居中列只有 2xl 宽（设置页那一族用的是这一档）。 */
export const DocumentNarrow: Story = {
  args: { width: "narrow" },
  render: (args) => (
    <Shell>
      <FrameSample width={args.width}>
        <Body />
      </FrameSample>
    </Shell>
  ),
};

/**
 * 带 `backdrop`（铺底）：它是**滚动层的兄弟**，所以内容滚动时铺底不动。
 * 塞进 `children` 的话它会成为居中列的第一个子节点并跟着滚走 —— 这一档是那条
 * 差异唯一能看到的地方。
 */
export const DocumentWithBackdrop: Story = {
  render: (args) => (
    <Shell>
      <DocumentFrame
        width={args.width}
        backdrop={
          <div className="bg-primary/10 pointer-events-none absolute inset-0 grid place-items-center">
            <span className="text-primary-strong text-xs">
              铺底（不随内容滚动）
            </span>
          </div>
        }
      >
        <Body rows={8} />
      </DocumentFrame>
    </Shell>
  ),
};

/**
 * 工作区型：外框**没有**页面级滚动条，滚动收在内部那一层。
 * 所以这里必须由内层自己 `overflow-y-auto` —— 这正是「哪一栏自己滚是视图的事」。
 */
export const Workspace: Story = {
  render: () => (
    <Shell>
      <WorkspaceFrame className="bg-canvas text-ink">
        <div className="border-border flex h-12 shrink-0 items-center border-b px-3 text-xs">
          固定工具栏（不滚）
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Body />
        </div>
      </WorkspaceFrame>
    </Shell>
  ),
};
