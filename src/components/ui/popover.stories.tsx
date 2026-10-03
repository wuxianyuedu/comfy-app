import React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";

/**
 * `ui/popover` 是基座浮层：**锚在某个元素上的卡片**（区别于 `tooltip` 的
 * 悬停提示与 `dialog` 的居中模态）。
 *
 * 它的封装修了两件事，两件都只有真点开才看得出：
 *
 * 1. **可用区域 = 视口减去应用级标题行**（`useOverlayBoundary()`）——
 *    壳态下窗口顶部有一条标题行，浮层不该盖住它。首帧量不到视口时返回 `null`，
 *    此时**不传**这一档、退回基元默认的 `clipping-ancestors`（而不是拿假矩形摆位）。
 * 2. **`anchor` 可以是外部元素 / 虚拟锚点**：不给 `PopoverTrigger` 时
 *    （浮层由外部状态打开、触发元素住在别处，如画布节点里的 `#id` 芯片）
 *    由 `anchor` 指定。这一档是本件比「包一个 trigger」多出来的能力。
 *
 * 翻转 / 收边（`flip` / `shift`）由 base-ui 的 Positioner 自带，不必自己夹紧视口。
 */
const meta = {
  title: "UI/Popover",
  component: Popover,
} satisfies Meta<typeof Popover>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 最常用：按钮触发一个小表单浮层（画布设置的那种弹层）。 */
export const Default: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" />}>
        输出尺寸
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <div className="flex flex-col gap-3">
          <Label htmlFor="popover-width">宽度</Label>
          <Input id="popover-width" defaultValue="1024" />
          <Label htmlFor="popover-height">高度</Label>
          <Input id="popover-height" defaultValue="1024" />
        </div>
      </PopoverContent>
    </Popover>
  ),
};

/** 四个方向并排：`side` 只改「想开在哪一边」，撞到视口边界时 base-ui 的
 *  `flip` 会把它翻到另一边 —— 所以这里四条同时点开，能看出收边行为。 */
export const Sides: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      {(["top", "right", "bottom", "left"] as const).map((side) => (
        <Popover key={side}>
          <PopoverTrigger render={<Button variant="outline" size="sm" />}>
            side={side}
          </PopoverTrigger>
          <PopoverContent side={side} className="w-40">
            <p className="text-sm">开在 {side} 这一侧</p>
          </PopoverContent>
        </Popover>
      ))}
    </div>
  ),
};

/** 受控打开：`open` + `onOpenChange` 由外部状态驱动
 *  —— 这正是「没有 trigger」那条路的入口（下面那档的 `anchor` 就是它的一部分）。 */
export const Controlled: Story = {
  render: () => <ControlledDemo />,
};

/** 受控包装（`render` 不是组件，用 hook 要抽一个真组件）。 */
function ControlledDemo() {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" />}>
        {open ? "点外面关闭" : "受控打开"}
      </PopoverTrigger>
      <PopoverContent className="w-56">
        <p className="text-sm">
          这次打开状态在 story 里（`useState`），不是基元内部。
        </p>
      </PopoverContent>
    </Popover>
  );
}
