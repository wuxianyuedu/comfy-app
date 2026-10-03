import {
  Copy,
  Download,
  FolderOpen,
  Settings,
  Share2,
  Trash2,
} from "lucide-react";
import type { Meta, StoryObj } from "@storybook/nextjs";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

/**
 * `ui/dropdown-menu` 是 base-ui Menu 的封装（**点击**触发的动作菜单）。
 *
 * 这一族有**四条彼此独立的轴**，散在四个不同的子部件上 —— 也就是说
 * 只看 `DropdownMenuItem` 的 props 是看不到全貌的：
 *
 * | 轴 | 住在哪 | 档 |
 * | --- | --- | --- |
 * | `variant` | `DropdownMenuItem` | `default` / `destructive` |
 * | `inset` | `DropdownMenuItem` 与 `SubTrigger` | 布尔（图标位空出来） |
 * | 勾选态 | `DropdownMenuCheckboxItem` | `checked` / `indeterminate` |
 * | 单选态 | `DropdownMenuRadioItem` | 组内互斥 |
 *
 * 下面按这四件事分组，而不是按「有没有子菜单」分 —— 分组依据是**判据**，
 * 不是排版习惯。
 */
type DropdownMenuItemVariant = NonNullable<
  React.ComponentProps<typeof DropdownMenuItem>["variant"]
>;

const ITEM_VARIANTS: DropdownMenuItemVariant[] = ["default", "destructive"];

const meta = {
  title: "UI/DropdownMenu",
  component: DropdownMenu,
} satisfies Meta<typeof DropdownMenu>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 真实落点：列表项的 `⋯` 菜单（分组 + 分隔线 + 快捷键提示）。 */
export const Default: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        打开菜单
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-52">
        <DropdownMenuLabel>工作流</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem>
            <FolderOpen /> 在文件夹中显示
            <DropdownMenuShortcut>⌘⇧F</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Copy /> 复制 ID
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Download /> 导出包
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
          <Trash2 /> 删除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

/** `variant` 两档并列：`destructive` 把图标与文字一起染成危险色
 *  —— 只有把两档放一起才看得出「颜色是成套切的」。 */
export const ItemVariants: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        variant 两档
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-52">
        {ITEM_VARIANTS.map((variant) => (
          <DropdownMenuItem key={variant} variant={variant}>
            <Settings /> variant={variant}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

/** `inset`：把左边的图标位空出来 —— 用于「这一组里有的项带图标、有的不带」
 *  时对齐文字。不给 `inset` 的话两种项的左边缘会错开一个图标宽。 */
export const Inset: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        inset 对齐
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuItem inset>inset：给图标留位</DropdownMenuItem>
        <DropdownMenuItem>
          <Settings /> 不带 inset：图标占位
        </DropdownMenuItem>
        <DropdownMenuItem inset>inset：文字与上面那个对齐</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

/** 勾选与单选：两个子部件各自持状态，且**都是非受控也能用**（`defaultChecked`
 *  / `defaultValue`）。单选那一组三条互斥。 */
export const CheckboxAndRadio: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        勾选 / 单选
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>显示列</DropdownMenuLabel>
        <DropdownMenuCheckboxItem defaultChecked>参数</DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem>节点</DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem>耗时</DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>排序</DropdownMenuLabel>
        <DropdownMenuRadioGroup defaultValue="updated">
          <DropdownMenuRadioItem value="updated">
            按更新时间
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="name">按名称</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="size">按体积</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

/** 子菜单：`SubTrigger` 自带右侧的 `ChevronRightIcon`（不用自己加），
 *  悬停 / 右方向键展开。两层的 `inset` 是各自独立的。 */
export const WithSubmenu: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        子菜单
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Share2 /> 分享到…
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44">
            <DropdownMenuItem>复制链接</DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger inset>导出为…</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-40">
                <DropdownMenuItem>PNG</DropdownMenuItem>
                <DropdownMenuItem>JPG</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem>
          <Settings /> 设置
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

/** 禁用项：`data-disabled` 让整项不可点且半透明 —— 它是「为什么这一项现在
 *  不能用」的唯一视觉出口，`disabled` 之外没有别的形态。 */
export const WithDisabled: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        含禁用项
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-52">
        <DropdownMenuItem>可用</DropdownMenuItem>
        <DropdownMenuItem disabled>
          <Download /> 还没产物（禁用）
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" disabled>
          运行中不能删除（禁用）
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};
