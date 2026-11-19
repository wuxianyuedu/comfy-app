import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

/** `ui/dialog` 是居中模态弹窗的基座（base-ui Dialog），本仓在这一层做过有意改动（`ui-customized` → 规范 16 §16.8），story 盯的就是这几处：
 * ① `w-full` + `max-w-[calc(100%-2rem)]`，且已删掉 `sm:max-w-sm`：变体宽度会被 Tailwind 产序排在所有无变体之后，不只压默认、连调用处传入的宽度一起压（ISSUE #720：三个日志弹窗的「加宽」长期按了没反应）；调用处只传 `w-*`（见 `ui/dialog-width`）。
 * ② `showCloseButton` 的默认值只服务一种形态；调用处只要自绘关闭按钮就必须传 `false`，漏传会渲出两枚几乎重合的关闭按钮，中间缝是「点了没反应」的死区。
 * ③ 遮罩不复用自绘样式：内容层不再画 Backdrop，样式与实际渲染串收口在 `dialog-overlay.ts`（同时满足「让出标题行」的硬判据）。
 * 弹窗受控 / 非受控都支持，Esc、点遮罩关闭、焦点锁与归还由 base-ui 负责。 */
const meta = {
  title: "UI/Dialog",
  component: Dialog,
} satisfies Meta<typeof Dialog>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 最常用：表单弹窗（header + 内容 + footer 三件）。 */
export const Default: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" />}>新建项目</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建项目</DialogTitle>
          <DialogDescription>项目产物会落在输出目录下的同名文件夹里。</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="dialog-name">名称</Label>
          <Input id="dialog-name" placeholder="例如 角色一致性" />
        </div>
        <DialogFooter showCloseButton>
          <Button>创建</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

/** 自绘 header：**这时必须 `showCloseButton={false}`** —— 不给就会出两枚
 *  `✕`（内置那枚绝对定位在右上角，与自绘的重叠，缝隙点不动）。 */
export const CustomHeader: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" />}>自绘 header</DialogTrigger>
      <DialogContent className="w-md" showCloseButton={false}>
        <div className="flex items-center justify-between border-b pb-3">
          <DialogTitle>运行日志</DialogTitle>
          <Button size="xs" variant="ghost">
            收起
          </Button>
        </div>
        <p className="text-ink-muted font-mono text-xs">
          [12:04:31] 开始解析节点包…（上下都不再出现第二个 ✕）
        </p>
      </DialogContent>
    </Dialog>
  ),
};

/** 宽度对比：默认卡片（`w-full` + `max-w-[calc(100%-2rem)]`，不贴满视口两侧）
 *  与调用处给的 `w-2xl`。后者能生效正是上面第 1 条 —— 调用处传 `w-*`
 *  跨族才比得过卡片的 `max-w-*`。 */
export const Widths: Story = {
  render: () => (
    <div className="flex gap-3">
      <Dialog>
        <DialogTrigger render={<Button variant="outline" />}>默认宽</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>默认宽度</DialogTitle>
            <DialogDescription>w-full + max-w-calc(100%-2rem)</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
      <Dialog>
        <DialogTrigger render={<Button variant="outline" />}>加宽 672px</DialogTrigger>
        <DialogContent className="w-2xl">
          <DialogHeader>
            <DialogTitle>调用处给 w-[42rem]</DialogTitle>
            <DialogDescription>这条能生效，是因为卡片自己不再带 sm:max-w-sm</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </div>
  ),
};

/** 受控打开：`open` + `onOpenChange` 由外部状态驱动（日志弹窗的加宽按钮是
 *  同一个模式 —— 面板状态住在调用处，不在基元里）。 */
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
        受控打开
      </Button>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>受控弹窗</DialogTitle>
            <DialogDescription>
              Esc / 点遮罩 / 点 ✕ 都会走到 onOpenChange(false)。
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </div>
  );
}
