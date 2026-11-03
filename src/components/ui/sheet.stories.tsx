import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";

import { Button } from "~/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "~/components/ui/sheet";

/**
 * `ui/sheet` 是侧边抽屉（从四边之一滑出），与 `ui/dialog` 同族但形态不同：dialog 居中，sheet 贴边铺满。本仓在这一层有过有意改动（`ui-customized`，规范 16 §16.8）：
 * ① `side` 四档靠 `data-[side=*]:` 给 `inset-y-0` / `w-3/4` / 位移动画；② `SheetContent` 自带 `Portal`（缺祖先会抛 `Base UI: <Dialog.Portal> is missing.` 打崩整树）；③ 遮罩共用 `dialog-overlay.ts`、须让出标题行（ISSUE #310）；④ `showCloseButton` 自绘 header 时传 `false`。
 */
const meta = {
  title: "UI/Sheet",
  component: Sheet,
} satisfies Meta<typeof Sheet>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 最常用：从右边滑出的详情面板。 */
export const Default: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" />}>打开详情</SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>角色一致性 · 三视图</SheetTitle>
          <SheetDescription>27 个节点 · 昨天更新</SheetDescription>
        </SheetHeader>
        <p className="text-ink-muted p-4 text-sm">
          抽屉里的人体布局与 dialog 不同：它是 `flex flex-col gap-4` 且高度铺满。
        </p>
      </SheetContent>
    </Sheet>
  ),
};

/**
 * 四档 `side` 并列。每档一张卡、各自可以单独点开 —— 排在一起是为了看
 * **滑入方向与贴边位置**：`top` / `bottom` 是横条（`max-h-3/4`），
 * `left` / `right` 是竖条（`w-3/4`）。
 */
export const Sides: Story = {
  render: () => (
    /* SAFETY: 类型断言已复核 */
    <div className="flex flex-wrap gap-3">
      {(["top", "right", "bottom", "left"] as const).map((side) => (
        <Sheet key={side}>
          <SheetTrigger render={<Button variant="outline" />}>side={side}</SheetTrigger>
          <SheetContent side={side}>
            <SheetHeader>
              <SheetTitle>side={side}</SheetTitle>
              <SheetDescription>
                {side === "top" || side === "bottom"
                  ? "横条：铺满宽度、max-h-3/4"
                  : "竖条：铺满高度、w-3/4"}
              </SheetDescription>
            </SheetHeader>
            <div className="p-4">
              <SheetClose render={<Button variant="ghost" />}>关闭</SheetClose>
            </div>
          </SheetContent>
        </Sheet>
      ))}
    </div>
  ),
};

/** 自绘 header：这时传 `showCloseButton={false}` —— 与 dialog 同款语义
 *  （漏传会出两枚几乎重合的 ✕）。 */
export const CustomHeader: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" />}>自绘 header</SheetTrigger>
      <SheetContent showCloseButton={false}>
        <div className="flex items-center justify-between border-b p-4">
          <SheetTitle>运行日志</SheetTitle>
          <SheetClose render={<Button size="xs" variant="ghost" />}>关闭</SheetClose>
        </div>
        <p className="text-ink-muted p-4 font-mono text-xs">[12:04:31] 开始解析节点包…</p>
      </SheetContent>
    </Sheet>
  ),
};

/** 受控打开：与 dialog 同款 —— 抽屉的开关状态住在调用处（如「点节点名
 *  打开详情」由 store 驱动），而不是靠 trigger。 */
export const Controlled: Story = {
  render: () => <ControlledDemo />,
};

function ControlledDemo() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col items-start gap-3">
      <Button
        onClick={() => {
          setOpen(true);
        }}
        variant="outline"
      >
        受控打开（右侧）
      </Button>
      <Sheet onOpenChange={setOpen} open={open}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>受控抽屉</SheetTitle>
            <SheetDescription>Esc / 点遮罩都会走到 onOpenChange</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    </div>
  );
}
