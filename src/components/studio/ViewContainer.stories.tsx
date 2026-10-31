import type { Meta, StoryObj } from "@storybook/nextjs";

import { DocumentFrame, WorkspaceFrame } from "~/components/studio/ViewContainer";
import { cn } from "~/lib/utils";

/**
 * 视图容器（`ViewContainer`）—— 两种框架形态，各屏按「怎么滚」选一种。
 *
 * 这两件没有数据依赖，但它们**几乎是纯布局**，所以「长得对」这件事在 story 里
 * 特别值得看：一屏用哪个框架决定了整屏会不会出现**双层滚动条**。
 *
 *   · **`DocumentFrame`**：整屏滚动 + 居中列，`width` 四档（`narrow` / `medium` /
 *     `wide` 三档有宽度令牌，`full` 不封顶）。`backdrop` 挂在**外框**里、是滚动层的
 *     兄弟（铺底若塞进 `children` 就成了居中列的第一个子节点，位置语义会变）——所以
 *     story 里给了带 `backdrop` 的那一档，它是唯一能看出那层关系的地方。
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
function FrameSample({ children, width }: StoryArgs & { children?: React.ReactNode }) {
  return <DocumentFrame width={width}>{children}</DocumentFrame>;
}

const meta = {
  args: { width: "wide" },
  argTypes: {
    width: {
      control: { type: "select" },
      options: ["narrow", "medium", "wide", "full"],
    },
  },
  component: FrameSample,
  title: "Studio/ViewContainer",
} satisfies Meta<StoryArgs & { children?: React.ReactNode }>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 假正文：滚动是不是真的发生，得有一段够长的内容才知道。 */
function Body({ rows = 24 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2 p-4">
      {Array.from({ length: rows }, (_, i) => (
        <div
          className="bg-surface border-border text-ink-soft rounded-lg border px-3 py-2 text-xs"
          key={i}
        >
          第 {String(i + 1)} 行 —— 内容要高过容器，滚动条才会出现
        </div>
      ))}
    </div>
  );
}

/** 演示用的外框。宽度可调 —— 宽度档位**只有在比最窄的档还宽的框里才看得出区别**：
 * 钉死 `w-160`（640px）时四个档位长得一模一样，story 说什么都行（这正是「文档写着
 * 四档、实现只有三档」长期没人发现的原因）。 */
function Shell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div
      className={cn(
        "border-border-strong h-72 overflow-hidden rounded-xl border",
        wide ? "w-full" : "w-160",
      )}
    >
      {children}
    </div>
  );
}

/** 文档型（宽栏）：整屏滚动，内容装在居中列里。 */
export const DocumentWide: Story = {
  render: (args) => (
    <Shell wide>
      <FrameSample width={args.width}>
        <Body />
      </FrameSample>
    </Shell>
  ),
};

/** 窄栏：居中列只有 `--container-narrow` 宽（设置页那一族用的是这一档）。 */
export const DocumentNarrow: Story = {
  args: { width: "narrow" },
  render: (args) => (
    <Shell wide>
      <FrameSample width={args.width}>
        <Body />
      </FrameSample>
    </Shell>
  ),
};

/** 不限宽（`full`）：内容吃满滚动区，给工具型文档视图（控制台那类输出面板）用。
 * 与上面两档对照着看 —— 只有框比 `--container-wide` 宽时，这一档才显出区别。 */
export const DocumentFull: Story = {
  args: { width: "full" },
  render: (args) => (
    <Shell wide>
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
        backdrop={
          <div className="bg-primary/10 pointer-events-none absolute inset-0 grid place-items-center">
            <span className="text-primary-strong text-xs">铺底（不随内容滚动）</span>
          </div>
        }
        width={args.width}
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
