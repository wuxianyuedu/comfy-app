import type { Meta, StoryObj } from "@storybook/nextjs";
import { RefreshCcw } from "lucide-react";

import { Button } from "~/components/ui/button";
import { SlotContent, SlotOutlet, SlotOutletProvider } from "~/components/ui/slot-outlet";

/**
 * `SlotOutlet` —— 「把子树渲染到别处的一个落点」的**全库唯一实现**
 * （规范 §12.18；应用是 `studio/ViewActions`，即「本屏动作挂到顶栏」）。
 *
 * 本 story 要看的只有一件事：**两种形态的差别**。上排是挂壳的样子 ——
 * 落点在「顶栏」那条横条里、内容传送过去；下排是**没挂落点**的样子 ——
 * 就地渲染，这正是 `/models` 独立路由页、Storybook、组件用例走的那一条。
 *
 * 传送机制本身不可见（内容就是宿主那一处的普通子节点，不浮、不遮、不抢焦点）——
 * 要浮层请用 `ui/dialog` / `ui/popover`。
 */
const meta = {
  component: SlotOutlet,
  title: "UI/SlotOutlet",
} satisfies Meta<typeof SlotOutlet>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 挂壳：落点在「顶栏」，按钮出现在那里。 */
export const WithOutlet: Story = {
  render: () => (
    <SlotOutletProvider>
      <div className="mb-4 flex items-center gap-2 rounded-lg border p-3">
        <span className="text-sm font-medium">顶栏</span>
        <SlotOutlet className="ml-auto gap-2" />
      </div>
      <SlotContent>
        <Button size="sm" variant="outline">
          <RefreshCcw aria-hidden className="size-3.5" />
          刷新
        </Button>
      </SlotContent>
    </SlotOutletProvider>
  ),
};

/** 没挂落点：内容原地渲染（不挂壳的渲染路径）。 */
export const WithoutOutlet: Story = {
  render: () => (
    <SlotOutletProvider>
      <SlotContent>
        <Button size="sm" variant="outline">
          <RefreshCcw aria-hidden className="size-3.5" />
          刷新
        </Button>
      </SlotContent>
    </SlotOutletProvider>
  ),
};
