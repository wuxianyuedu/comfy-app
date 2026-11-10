import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";

/** `ConfirmDialog` 是跟随应用主题的居中确认弹窗，替换 `window.confirm()` / `window.alert()`（后者贴视口左上、忽略深色 CSS）。
 * 它基于 `ui/dialog`（不再自搓 createPortal + 手写 Esc + 手写遮罩点击），Esc / 点遮罩关闭、焦点锁、焦点归还都由基元负责，本件只管「确认弹窗长什么样」。
 * 几条真点开才看得出的口径：① 两档语义色（danger / 信息）的 ring / 边框 / 图标一起切，颜色全走语义 token（曾写死 `violet-500/600` 6 处，绕开 `--color-primary`）；② 确认按钮等一帧后 focus（等 portal 挂载），Enter 立刻触发，每次打开重置；③ `pending` 令确认按钮转 spinner 并禁用；④ `aria-labelledby` 每实例一个 `useId`，写死 id 会在多弹窗同挂时撞车、读屏念到别处标题。 */
const meta = {
  title: "UI/ConfirmDialog",
  component: ConfirmDialog,
  args: {
    open: false,
    onClose: () => undefined,
    onConfirm: () => undefined,
    title: "确认操作",
  },
} satisfies Meta<typeof ConfirmDialog>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 受控包装（`open` / `onClose` 住在调用处）。 */
function Demo(props: Partial<React.ComponentProps<typeof ConfirmDialog>>) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
        }}
        variant="outline"
      >
        打开确认弹窗
      </Button>
      <ConfirmDialog
        cancelLabel={props.cancelLabel}
        confirmLabel={props.confirmLabel}
        danger={props.danger}
        description={props.description}
        icon={props.icon}
        onClose={() => {
          setOpen(false);
        }}
        onConfirm={() => {
          setOpen(false);
        }}
        open={open}
        pending={props.pending}
        title={props.title ?? "确认操作"}
      />
    </>
  );
}

/** 信息档（默认）：蓝色 ring + Info 图标，用于「要不要做这件事」。 */
export const Info: Story = {
  render: () => (
    <Demo
      confirmLabel="同步"
      description={"本机库结构落后于源码。\n同步会按 schema 建表。"}
      title="同步数据库结构？"
    />
  ),
};

/** 危险档：红色 ring + TriangleAlert 图标 —— 删除类操作走这一档。
 *  两档只有并排看才知道色是成套切的。 */
export const Danger: Story = {
  render: () => (
    <Demo
      confirmLabel="删除"
      danger
      description="项目产物与运行记录会一起删掉，此操作不可撤销。"
      title="删除这个项目？"
    />
  ),
};

/** `pending`：确认按钮转 spinner 并禁用 —— 「点完等结果」那段不给重复点。
 *  注意这个档**只是形态**：真异步流程由调用处把 `pending` 接上。 */
export const Pending: Story = {
  render: () => (
    <Demo confirmLabel="删除" danger description="这一步可能要几秒钟。" pending title="正在删除…" />
  ),
};

/** 自定义图标与按钮文案：`icon` 传节点就覆盖默认那两档。 */
export const CustomIcon: Story = {
  render: () => (
    <Demo
      cancelLabel="换个名字"
      confirmLabel="覆盖"
      description="同名文件会被替换。"
      icon={<span aria-hidden>📄</span>}
      title="覆盖已存在的文件？"
    />
  ),
};
