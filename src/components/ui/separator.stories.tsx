import type { Meta, StoryObj } from "@storybook/nextjs";

import { Separator } from "~/components/ui/separator";

/**
 * `ui/separator` 的形态**全在两根轴上**：`orientation` 决定尺寸方向，
 * 但它真正的价值是「**在 flex 容器里怎么占位**」——
 *
 * - `horizontal`：`h-px w-full`（1 像素的分隔线，横向占满）；
 * - `vertical`：`w-px self-stretch`（竖线**撑满容器高度** —— 这一条只有放进
 *   一个高度由内容决定的 flex 行里才看得出：`self-stretch` 会跟着最高的兄弟
 *   长起来，而不是塌成 0 高）。
 *
 * 所以「竖档 0 高度」是这类组件的经典错法，也是本 story 存在的理由。
 * 枚举从 props 派生（规范 16 §16.2.3.4）。
 */
type SeparatorOrientation = NonNullable<
  React.ComponentProps<typeof Separator>["orientation"]
>;

const ORIENTATIONS: SeparatorOrientation[] = ["horizontal", "vertical"];

const meta = {
  title: "UI/Separator",
  component: Separator,
} satisfies Meta<typeof Separator>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {
  args: { orientation: "horizontal" },
  render: (args) => (
    <div className="w-[24rem]">
      <div className="text-sm">工作流库</div>
      <Separator {...args} className="my-3" />
      <div className="text-sm">模型库</div>
    </div>
  ),
};

/** 竖档：`self-stretch` 让竖线撑到同行最高兄弟的高度 —— 拿掉它这根线就是 0 高。 */
export const Vertical: Story = {
  args: { orientation: "vertical" },
  render: (args) => (
    <div className="flex h-16 items-center gap-3">
      <span className="text-sm">左侧</span>
      <Separator {...args} />
      <span className="text-sm">右侧</span>
    </div>
  ),
};

/** 两档并列，且竖档特意放进一个**高**容器（`h-16`）里 —— 竖档的
 *  `self-stretch` 与横档的 `w-full` 谁也没法在另一档的现场里看清。 */
export const Orientations: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      {ORIENTATIONS.map((orientation) => (
        <div key={orientation} className="flex flex-col gap-2">
          <span className="text-ink-muted font-mono text-[11px]">
            orientation={orientation}
          </span>
          {orientation === "horizontal" ? (
            <div className="w-[24rem]">
              <div className="text-sm">上</div>
              <Separator orientation={orientation} className="my-2" />
              <div className="text-sm">下</div>
            </div>
          ) : (
            <div className="flex h-16 items-center gap-3">
              <span className="text-sm">左</span>
              <Separator orientation={orientation} />
              <span className="text-sm">右</span>
            </div>
          )}
        </div>
      ))}
    </div>
  ),
};
