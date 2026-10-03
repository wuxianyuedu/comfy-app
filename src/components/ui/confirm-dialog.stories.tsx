import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";

import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";

/**
 * `ConfirmDialog` 是**跟随应用主题的居中确认弹窗**，替换 `window.confirm()` /
 * `window.alert()`（后者贴视口左上、忽略深色 CSS）。
 *
 * 它基于 `ui/dialog`（不再自搓 `createPortal` + 手写 Esc + 手写遮罩点击），
 * 于是 Esc / 点遮罩关闭、焦点锁在弹窗内、关闭后焦点归还触发元素这几条
 * 无障碍行为都由基元负责，本件只管「确认弹窗长什么样」。
 *
 * 几条只有真点开才看得出的口径：
 *
 * 1. **两档语义色**（`danger` / 信息）：卡片 ring / 边框 / 图标颜色一起切，
 *    颜色全走语义 token（这里曾把 `violet-500/600` 写死 6 处，
 *    于是「改品牌色」对它不起作用 —— 它绕开了 `--color-primary`）。
 * 2. **确认按钮自动聚焦**：等一帧后 `focus()`（等 portal 挂载），
 *    Enter 立刻触发它 —— 与原生 `confirm()` 的肌肉记忆一致。每次打开都重置。
 * 3. **`pending`**：确认按钮转 spinner 态并禁用，用于「点完等结果」那一段。
 * 4. **`aria-labelledby` 每个实例一个 id**（`useId`）：`title` 写死 id 会在
 *    多个弹窗同时挂载时撞车，读屏器念到别处的标题。
 */
const meta = {
  title: "UI/ConfirmDialog",
  component: ConfirmDialog,
  args: {
    open: false,
    onClose: () => void 0,
    onConfirm: () => void 0,
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
      <Button variant="outline" onClick={() => setOpen(true)}>
        打开确认弹窗
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={() => setOpen(false)}
        title={props.title ?? "确认操作"}
        description={props.description}
        confirmLabel={props.confirmLabel}
        cancelLabel={props.cancelLabel}
        danger={props.danger}
        pending={props.pending}
        icon={props.icon}
      />
    </>
  );
}

/** 信息档（默认）：蓝色 ring + Info 图标，用于「要不要做这件事」。 */
export const Info: Story = {
  render: () => (
    <Demo
      title="同步数据库结构？"
      description={"本机库结构落后于源码。\n同步会按 schema 建表。"}
      confirmLabel="同步"
    />
  ),
};

/** 危险档：红色 ring + TriangleAlert 图标 —— 删除类操作走这一档。
 *  两档只有并排看才知道色是成套切的。 */
export const Danger: Story = {
  render: () => (
    <Demo
      title="删除这个项目？"
      description={"项目产物与运行记录会一起删掉，此操作不可撤销。"}
      confirmLabel="删除"
      danger
    />
  ),
};

/** `pending`：确认按钮转 spinner 并禁用 —— 「点完等结果」那段不给重复点。
 *  注意这个档**只是形态**：真异步流程由调用处把 `pending` 接上。 */
export const Pending: Story = {
  render: () => (
    <Demo
      title="正在删除…"
      description="这一步可能要几秒钟。"
      confirmLabel="删除"
      danger
      pending
    />
  ),
};

/** 自定义图标与按钮文案：`icon` 传节点就覆盖默认那两档。 */
export const CustomIcon: Story = {
  render: () => (
    <Demo
      title="覆盖已存在的文件？"
      description="同名文件会被替换。"
      confirmLabel="覆盖"
      cancelLabel="换个名字"
      icon={<span aria-hidden>📄</span>}
    />
  ),
};
