import type { Meta, StoryObj } from "@storybook/nextjs";
import { FolderOpen, ImageOff } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";

/**
 * `ui/empty` 是 shadcn 的**空态基元族**（`Empty` / `EmptyHeader` / `EmptyMedia`
 * / `EmptyTitle` / `EmptyDescription` / `EmptyContent`）。
 *
 * 它与 `ui/empty-state` 的关系要说清，否则两边都会被误当成「重复实现」：
 * `empty-state` 是**业务出口**（三档 `page` / `error` / `hint`，props 是
 * `{title, description, icon, action}`），它的 `page` / `error` 两档内部就渲染
 * 这一族；本件是**基元**，多出来的是 `EmptyMedia` 的 `variant` 轴与「拼装自由」。
 * 给基元写 story 的意义正是把那一轴与拼装形态定下来 —— 业务出口的 story
 * （`EmptyState`）看不到 `variant=icon` 那档。
 *
 * `EmptyMedia` 是这一族**唯一有变体轴**的部件，枚举从 props 派生
 * （规范 16 §16.2.3.4）。
 */
type EmptyMediaVariant = NonNullable<
  React.ComponentProps<typeof EmptyMedia>["variant"]
>;

const MEDIA_VARIANTS: EmptyMediaVariant[] = ["default", "icon"];

/* `variant` 这一轴住在 `EmptyMedia` 上（`Empty` 本体没有变体），
   所以 `component` 指向 `EmptyMedia` —— Args 面板的控件是按 `component` 的
   props 生成的，挂在别的组件上会要么被类型挡住、要么运行期不生效。 */
const meta = {
  title: "UI/Empty",
  component: EmptyMedia,
  args: { variant: "icon" },
  argTypes: {
    variant: { control: "select", options: MEDIA_VARIANTS },
  },
} satisfies Meta<typeof EmptyMedia>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 完整拼装：图标方块 + 标题 + 说明 + 操作按钮 —— 与 `empty-state` 的
 *  `page` 档同一形态。 */
export const Default: Story = {
  render: (args) => (
    <Empty {...args} className="w-md">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderOpen />
        </EmptyMedia>
        <EmptyTitle>还没有工作流</EmptyTitle>
        <EmptyDescription>
          从磁盘导入一个工作流包，或者从模板新建一个。
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm">导入工作流</Button>
      </EmptyContent>
    </Empty>
  ),
};

/** 两档 `EmptyMedia`：`default` 是裸容器，`icon` 给一个 32×32 的圆角方块
 *  —— 后者是列表空态更常见的形态（对齐 `empty-state` 的视觉）。 */
export const MediaVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      {MEDIA_VARIANTS.map((variant) => (
        <Empty key={variant} className="w-md">
          <EmptyHeader>
            <EmptyMedia variant={variant}>
              <ImageOff />
            </EmptyMedia>
            <EmptyTitle>EmptyMedia variant={variant}</EmptyTitle>
            <EmptyDescription>
              default 无底色，icon 给 size-8 / rounded-lg / bg-muted。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ))}
    </div>
  ),
};

/** 只给标题：`Empty` 自身是居中 flex 列，少一层说明也不会歪
 *  —— 这是「行内小空态」在设置卡片里的常见形态。 */
export const TitleOnly: Story = {
  render: (args) => (
    <Empty {...args} className="w-md">
      <EmptyHeader>
        <EmptyTitle>暂无可选项</EmptyTitle>
      </EmptyHeader>
    </Empty>
  ),
};
