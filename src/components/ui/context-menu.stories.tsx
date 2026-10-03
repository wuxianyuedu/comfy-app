import { Copy, Pencil, Trash2 } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/nextjs";

import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "~/components/ui/context-menu";

/**
 * `ui/context-menu` 是 base-ui ContextMenu 的封装 —— 与 `dropdown-menu`
 * **同一套子部件、同一个形态**，唯一的差别是**触发方式**：
 * 右键 / 长按（而不是点一下）。它多出来的是「触点即锚点」：
 * 浮层落在鼠标位置，而不是触发元素的下方。
 *
 * 因此本 story 要看的不是「菜单长什么样」（那与 dropdown-menu 一致），
 * 而是**在哪儿弹出来** —— 以及 `useOverlayBoundary()` 那条：可用区域是
 * 视口减去应用级标题行（壳态），首帧量不到时退回基元默认的
 * `clipping-ancestors`，而不是拿假矩形摆位。
 *
 * ⚠️ 画布上要**右键**才弹得出来。
 */
const meta = {
  title: "UI/ContextMenu",
  component: ContextMenu,
} satisfies Meta<typeof ContextMenu>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 真实落点：工作流卡片右键菜单。右键卡片上任意位置，浮层落在指针处。 */
export const Default: Story = {
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger className="flex h-32 w-96 items-center justify-center rounded-lg border border-dashed">
        <span className="text-ink-muted text-sm">在这里右键</span>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem>
          <Pencil /> 重命名
          <ContextMenuShortcut>F2</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem>
          <Copy /> 复制 ID
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive">
          <Trash2 /> 删除
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  ),
};

/** 触点即锚点：在触发器**四个角**分别右键，浮层都从指针处展开
 *  —— 与 dropdown-menu「永远落在元素下方」是两件事，也是本件独立的理由。 */
export const AtPointer: Story = {
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger className="grid h-40 w-96 grid-cols-2 grid-rows-2 gap-px rounded-lg border bg-[image:repeating-linear-gradient(45deg,transparent_0_8px,var(--color-surface-2)_8px_16px)]">
        {["左上", "右上", "左下", "右下"].map((corner) => (
          <span
            key={corner}
            className="text-ink-muted flex items-center justify-center text-xs"
          >
            在{corner}右键
          </span>
        ))}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem>光标在哪就弹在哪</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  ),
};

/** 分组 + 标签 + 勾选 + 单选 + 子菜单：一屏铺完这一族的全部子部件
 *  —— 子部件与 dropdown-menu 同源，这一条的价值是「右键菜单也能有全套」。 */
export const FullParts: Story = {
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger className="flex h-32 w-96 items-center justify-center rounded-lg border border-dashed">
        <span className="text-ink-muted text-sm">右键看全套部件</span>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        <ContextMenuLabel>节点操作</ContextMenuLabel>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem>在节点列表中定位</ContextMenuItem>
          <ContextMenuItem inset>复制 class_type</ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuCheckboxItem defaultChecked>
          显示提示词
        </ContextMenuCheckboxItem>
        <ContextMenuCheckboxItem>显示输出</ContextMenuCheckboxItem>
        <ContextMenuSeparator />
        <ContextMenuLabel>颜色</ContextMenuLabel>
        <ContextMenuRadioGroup defaultValue="default">
          <ContextMenuRadioItem value="default">默认</ContextMenuRadioItem>
          <ContextMenuRadioItem value="warn">待检查</ContextMenuRadioItem>
        </ContextMenuRadioGroup>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>导出…</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-40">
            <ContextMenuItem>JSON</ContextMenuItem>
            <ContextMenuItem>PNG</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  ),
};
