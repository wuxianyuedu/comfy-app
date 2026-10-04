import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";

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

/**
 * `ui/dialog` 是居中模态弹窗的基座（base-ui Dialog）。本仓在这一层做过**有意改动**
 * （文件头的 `ui-customized` 标记指向规范 16 §16.8），story 要盯的正是那几处：
 *
 * 1. **`w-full` + `max-w-[calc(100%-2rem)]`，**并且 `sm:max-w-sm` 已被删掉。
 *    原因（ISSUE #720）：变体宽度（`sm:max-w-sm`）会被 Tailwind 的产序排在所有
 *    无变体 utility 之后，于是它不只压默认、**连调用处传进来的宽度一起压** ——
 *    三个日志弹窗的「加宽」按钮长期是按了没反应。所以调用处现在只传 `w-*`
 *    （见 `ui/dialog-width`），跟 `max-w-*` 打架只会得到「谁赢看产序」。
 * 2. **`showCloseButton` 的默认值只服务一种形态**：`true` 时渲染右上角内置的
 *    `✕`。**调用处只要自绘了关闭按钮就必须传 `false`** —— 漏传会同时渲染出
 *    两枚位置几乎重合的关闭按钮，中间那道缝还是「点了没反应」的死区。
 * 3. **遮罩不复用自绘样式**：内容层不再画 Backdrop，样式与实际渲染串在
 *    `dialog-overlay.ts` 里收口一次（它同时要满足「让出标题行」的硬判据）。
 *
 * 弹窗是**受控 / 非受控都支持**的；base-ui 负责 Esc、点遮罩关闭、焦点锁与归还。
 */
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
      <DialogTrigger render={<Button variant="outline" />}>
        新建项目
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建项目</DialogTitle>
          <DialogDescription>
            项目产物会落在输出目录下的同名文件夹里。
          </DialogDescription>
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
      <DialogTrigger render={<Button variant="outline" />}>
        自绘 header
      </DialogTrigger>
      <DialogContent showCloseButton={false} className="w-md">
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
        <DialogTrigger render={<Button variant="outline" />}>
          默认宽
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>默认宽度</DialogTitle>
            <DialogDescription>
              w-full + max-w-calc(100%-2rem)
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
      <Dialog>
        <DialogTrigger render={<Button variant="outline" />}>
          加宽 672px
        </DialogTrigger>
        <DialogContent className="w-2xl">
          <DialogHeader>
            <DialogTitle>调用处给 w-[42rem]</DialogTitle>
            <DialogDescription>
              这条能生效，是因为卡片自己不再带 sm:max-w-sm
            </DialogDescription>
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
      <Button variant="outline" onClick={() => setOpen(true)}>
        受控打开
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
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
