import type { Meta, StoryObj } from "@storybook/nextjs";

import { ScrollArea } from "~/components/ui/scroll-area";

/**
 * `ui/scroll-area` 是「自定义滚动条」的容器：内容超出时右侧出现一条细轨
 * （`ScrollBar` 的 `w-2.5` + `Thumb` 的 `rounded-full bg-border`），
 * 而不是系统滚动条。
 *
 * 形态上唯一容易踩空的一点：**它必须有一个确定高度的祖先**。给的是
 * `h-40` / `h-64` 这类**固定高度**，不是 `max-h-*` —— `size-full` 的 Viewport
 * 需要一个能算出「溢出多少」的高度，容器高度由内容决定时滚动条永远不出现。
 * 所以下面每条 story 都给死高度，这也是调用处的真实形态（面板 / 弹层）。
 */
const meta = {
  title: "UI/ScrollArea",
  component: ScrollArea,
} satisfies Meta<typeof ScrollArea>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 纵向：一列比容器高的行 —— 右侧那条细轨是 `ScrollBar` 自己插的
 *  （调用处不用手写 `<ScrollBar>`）。 */
export const Vertical: Story = {
  render: (args) => (
    <ScrollArea {...args} className="h-40 w-64 rounded-lg border">
      <div className="flex flex-col gap-2 p-3">
        {Array.from({ length: 20 }, (_, index) => (
          <div
            key={index}
            className="bg-surface-2 rounded-md px-2 py-1 font-mono text-xs"
          >
            节点 #{index + 1} · KSampler
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
};

/** 横向 + 纵向同时出现：`ScrollBar` 的 `orientation` 默认为 `vertical`，
 *  横向那条要显式给 `orientation="horizontal"`（并自己插进容器）——
 *  这也是「什么时候要手写 ScrollBar」的判据。 */
export const BothAxes: Story = {
  render: (args) => (
    <ScrollArea {...args} className="h-40 w-64 rounded-lg border">
      <div className="flex w-160 flex-col gap-2 p-3">
        {Array.from({ length: 12 }, (_, index) => (
          <div
            key={index}
            className="bg-surface-2 rounded-md px-2 py-1 font-mono text-xs whitespace-nowrap"
          >
            {`{ "3": { class_type: "KSampler", inputs: { steps: ${String(index + 10)} } } }`}
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
};

/** 内容不溢出：滚动条整条不渲染（`overflow-x-hidden` 也一并消失），
 *  所以「加不加 ScrollArea」在短列表上视觉完全相同 —— 这一条要在，
 *  免得有人以为没出现滚动条就是组件坏了。 */
export const NoOverflow: Story = {
  render: (args) => (
    <ScrollArea {...args} className="h-40 w-64 rounded-lg border">
      <div className="flex flex-col gap-2 p-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div
            key={index}
            className="bg-surface-2 rounded-md px-2 py-1 font-mono text-xs"
          >
            节点 #{index + 1}
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
};
