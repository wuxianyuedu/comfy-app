import type { Meta, StoryObj } from "@storybook/nextjs";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";

/**
 * `ui/tabs` 是 shadcn 的页签名基元（base-ui Tabs）。全库的「详情三页签」
 * （工作流库、任务详情）都走它，所以两档形态都要有现场：
 *
 * - `default`：药丸底（`bg-muted`），页签贴在一条灰色胶囊上；
 * - `line`：无底 + 当前项下方一条 2px 下划线（`after:` 那条），
 *   详情页顶部用它跟标题栏对齐。
 *
 * `orientation` 是**真实的第二根轴**（`group-data-vertical/tabs:*` 那一串全靠它），
 * 此前没有 story 就没人看得到「竖排时下划线跑到右边」这件事。
 *
 * 枚举从 props 派生（不从 `tabsListVariants` 的返回值上取 —— `cva()` 返回函数、
 * 运行期没有 `.variants`，见 `button.stories.tsx` 的注释与规范 16 §16.2.3.4）。
 */
type TabsListVariant = NonNullable<
  React.ComponentProps<typeof TabsList>["variant"]
>;
type TabsOrientation = NonNullable<
  React.ComponentProps<typeof Tabs>["orientation"]
>;

const VARIANTS: TabsListVariant[] = ["default", "line"];
const ORIENTATIONS: TabsOrientation[] = ["horizontal", "vertical"];

/* `variant` 这一轴住在 `TabsList` 上（`Tabs` 本体只有 `orientation`），
   所以 `component` 指向 `TabsList` —— Args 面板的控件按 `component` 的 props 生成。 */
const meta = {
  title: "UI/Tabs",
  component: TabsList,
  args: { variant: "default" },
  argTypes: {
    variant: { control: "select", options: VARIANTS },
  },
} satisfies Meta<typeof TabsList>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 详情页的真实形状：三个页签 + 各自的面板。 */
export const Default: Story = {
  render: (args) => (
    <Tabs {...args} className="w-lg">
      <TabsList>
        <TabsTrigger value="params">参数</TabsTrigger>
        <TabsTrigger value="nodes">节点</TabsTrigger>
        <TabsTrigger value="history">历史</TabsTrigger>
      </TabsList>
      <TabsContent value="params" className="text-ink-muted px-2">
        这里是对外参数（workflowIO）的编辑区。
      </TabsContent>
      <TabsContent value="nodes" className="text-ink-muted px-2">
        这里是节点包解析出来的节点列表。
      </TabsContent>
      <TabsContent value="history" className="text-ink-muted px-2">
        这里是这个工作流的运行记录。
      </TabsContent>
    </Tabs>
  ),
};

/** 两档形态并列：`default` 是胶囊底，`line` 是纯下划线（`after:` 那条只在
 *  当前项上 `opacity-1`）。 */
export const ListVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      {VARIANTS.map((variant) => (
        <Tabs key={variant} defaultValue="a" className="w-lg">
          <span className="text-ink-muted font-mono text-[11px]">
            TabsList variant={variant}
          </span>
          <TabsList variant={variant}>
            <TabsTrigger value="a">概览</TabsTrigger>
            <TabsTrigger value="b">明细</TabsTrigger>
            <TabsTrigger value="c">设置</TabsTrigger>
          </TabsList>
        </Tabs>
      ))}
    </div>
  ),
};

/**
 * 两根轴交叉：`orientation` 改的是 `Tabs` 本体的 `data-orientation`，
 * `TabsList` / `TabsTrigger` 靠 `group-data-vertical/tabs:*` 跟着变
 * （竖排时列表变列、下划线从底部挪到右边）。这一组只有并排看才看得出差别。
 */
export const Orientations: Story = {
  render: () => (
    <div className="flex items-start gap-10">
      {ORIENTATIONS.map((orientation) => (
        <Tabs
          key={orientation}
          orientation={orientation}
          defaultValue="a"
          className="w-64"
        >
          <span className="text-ink-muted font-mono text-[11px]">
            orientation={orientation}
          </span>
          <TabsList variant="line">
            <TabsTrigger value="a">参数</TabsTrigger>
            <TabsTrigger value="b">节点</TabsTrigger>
          </TabsList>
          <TabsContent value="a" className="text-ink-muted px-2">
            参数面板
          </TabsContent>
          <TabsContent value="b" className="text-ink-muted px-2">
            节点面板
          </TabsContent>
        </Tabs>
      ))}
    </div>
  ),
};

/** 禁用档：`disabled` 的触发项 `pointer-events-none` + 半透明，键盘也进不去。 */
export const WithDisabled: Story = {
  render: () => (
    <Tabs defaultValue="a" className="w-lg">
      <TabsList>
        <TabsTrigger value="a">可用</TabsTrigger>
        <TabsTrigger value="b" disabled>
          暂不可用
        </TabsTrigger>
        <TabsTrigger value="c">可用</TabsTrigger>
      </TabsList>
    </Tabs>
  ),
};
