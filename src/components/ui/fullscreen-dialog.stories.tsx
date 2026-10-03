import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";

import { Button } from "~/components/ui/button";
import { FullScreenDialog } from "~/components/ui/fullscreen-dialog";

/**
 * `FullScreenDialog` 是**全屏视图形态的弹窗基元**（铺满应用级标题行下方的
 * 整个内容区），与 `ui/dialog` 是同族但形态不同 —— 两者**不能靠调用处覆盖
 * class 拼出来**：
 *
 * - `DialogContent` 是居中卡片（`fixed top-1/2 left-1/2 -translate-x-1/2`）；
 * - 全屏层要的是「让出标题行、铺满其余内容区」，而它的定位类
 *   （`top-title-bar` / `bottom-6`）是本项目的**自定义工具类**，
 *   class 合并器（`cn`）不认识它们 —— 默认的 `top-1/2` 与 `-translate-y-1/2`
 *   会**残留**下来（实测），把面板顶到标题行上方、底部还留一条缝。
 *   所以定位只在基元这一层给一次，调用处只提供布局类（§17.2 第③层只渲染）。
 *
 * 三条行为都是有来由的，story 要盯的就是它们：
 *
 * 1. **铺满但**不铺到 `bottom-0`：底部状态栏是 `z-toast` 的固定悬浮层，
 *    铺满会把它压住（日志全屏视图实测「最后几行看不到」）。
 * 2. **禁掉点弹窗外关闭**（`disablePointerDismissal`）：全屏后弹窗外只剩窗口
 *    标题栏，用户想拖窗口的肌肉记忆会**把整个全屏视图关掉**（用户实测反馈）。
 *    只有显式出口（退出按钮 / Esc）能关。
 * 3. **`label` 是必填的**：它渲染成只读屏器可见的 `Dialog.Title`，
 *    并自动接到弹窗的 `aria-labelledby` —— 全屏视图通常没有可见标题。
 *
 * 受控：`open` / `onOpenChange` 住在调用处。
 */
const meta = {
  title: "UI/FullScreenDialog",
  component: FullScreenDialog,
  args: {
    open: false,
    onOpenChange: () => void 0,
    label: "全屏视图",
    children: null,
  },
} satisfies Meta<typeof FullScreenDialog>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 受控包装（story 里自己持一份 state 才点得开）。 */
function Demo(props: { label: string; body: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        打开全屏视图
      </Button>
      <FullScreenDialog
        open={open}
        onOpenChange={setOpen}
        label={props.label}
        className="bg-bg"
      >
        <div className="flex items-center justify-between border-b p-3">
          <span className="text-sm font-medium">{props.label}</span>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            退出全屏
          </Button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          <p className="text-ink-muted text-sm">{props.body}</p>
        </div>
      </FullScreenDialog>
    </>
  );
}

export const Default: Story = {
  render: () => (
    <Demo
      label="运行日志"
      body="这个面板铺满标题行下方，但不铺到窗口底部 —— 底部那条状态栏不会被压住。"
    />
  ),
};

/** 点遮罩不关闭：全屏后弹窗外只剩窗口标题栏，「想拖窗口」的肌肉记忆
 *  不该把视图关掉。所以这一档**只能**用「退出全屏」或 Esc 关
 *  —— 与 dialog 的「点外面即关」正好相反。 */
export const PointerDismissDisabled: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-2">
      <Demo
        label="全屏（点外面不关）"
        body="试着点面板外面看看：不会关。用「退出全屏」按钮或 Esc。"
      />
      <p className="text-ink-muted text-xs">
        这也是本件与 ui/dialog 最容易被误当成「同一个东西」的一处差别。
      </p>
    </div>
  ),
};

/** 自定义 `zClass`：面板需要盖在别的浮层之上时传更高的档
 *  （默认 `z-100`）。这一档只有在有别的浮层同时开着时才看得出。 */
export const CustomZ: Story = {
  render: () => (
    <Demo
      label="更高的层级（z-110）"
      body="调用处可以抬高层级 —— 但要记得浮层刻度里没有裸数字（规范 16 §16.2.5）。"
    />
  ),
};
