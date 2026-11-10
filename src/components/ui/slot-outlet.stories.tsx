import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { RefreshCcw } from "lucide-react";

import { Button } from "~/components/ui/button";
import { SlotContent, SlotOutlet, SlotOutletProvider } from "~/components/ui/slot-outlet";

/**
 * `SlotOutlet` —— 「把子树渲染到别处的一个落点」的全库唯一实现（规范 §12.18；应用是 `studio/ViewActions`，即「本屏动作挂到顶栏」）。要看的只有两种形态的差别：
 * 上排挂壳（落点在顶栏、内容传送过去），下排没挂落点（就地渲染，`/models` 独立路由页、Storybook、用例走这条）。传送机制本身不可见（就是宿主处的普通子节点，不浮、不遮、不抢焦点）。
 */
const meta = {
  title: "UI/SlotOutlet",
  component: SlotOutlet,
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
