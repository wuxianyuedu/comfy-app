import type { Meta, StoryObj } from "@storybook/nextjs";

import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "~/components/ui/menubar";

/**
 * `ui/menubar` 是**应用级菜单栏**：一排菜单项，点开各自的浮层，
 * 且**在同一排里左右移动会自动切换打开的菜单**（这是它与 `dropdown-menu`
 * 唯一的实质差别 —— 后者是一次性动作菜单，点开、选一个、关掉）。
 *
 * 于是本 story 要看的不是「菜单项长什么样」（与 dropdown-menu 同源），而是
 * **横排的联动**：画布上点开「文件」，再把鼠标移到「编辑」上，浮层会跟过去。
 *
 * 子部件与 dropdown-menu 完全同源（`MenubarMenu` 内部直接用 `DropdownMenu`
 * 那一族），所以这里只铺一次全套，不按轴拆。
 */
const meta = {
  title: "UI/Menubar",
  component: Menubar,
} satisfies Meta<typeof Menubar>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 真实落点：三档菜单 + 子菜单 + 快捷键提示。 */
export const Default: Story = {
  render: () => (
    <Menubar>
      <MenubarMenu>
        <MenubarTrigger>文件</MenubarTrigger>
        <MenubarContent className="w-52">
          <MenubarItem>
            新建项目
            <MenubarShortcut>⌘N</MenubarShortcut>
          </MenubarItem>
          <MenubarItem>
            打开…
            <MenubarShortcut>⌘O</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator />
          <MenubarSub>
            <MenubarSubTrigger>最近打开</MenubarSubTrigger>
            <MenubarSubContent className="w-48">
              <MenubarItem>角色一致性 · 三视图</MenubarItem>
              <MenubarItem>首帧 → 逐镜生成</MenubarItem>
            </MenubarSubContent>
          </MenubarSub>
          <MenubarSeparator />
          <MenubarItem variant="destructive">退出</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>编辑</MenubarTrigger>
        <MenubarContent className="w-52">
          <MenubarItem>
            撤销
            <MenubarShortcut>⌘Z</MenubarShortcut>
          </MenubarItem>
          <MenubarItem>
            重做
            <MenubarShortcut>⇧⌘Z</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem disabled>粘贴（剪贴板为空）</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>视图</MenubarTrigger>
        <MenubarContent className="w-56">
          <MenubarLabel>显示</MenubarLabel>
          <MenubarSeparator />
          <MenubarCheckboxItem defaultChecked>侧栏</MenubarCheckboxItem>
          <MenubarCheckboxItem>状态栏</MenubarCheckboxItem>
          <MenubarSeparator />
          <MenubarLabel>密度</MenubarLabel>
          <MenubarRadioGroup defaultValue="comfortable">
            <MenubarRadioItem value="comfortable">舒适</MenubarRadioItem>
            <MenubarRadioItem value="compact">紧凑</MenubarRadioItem>
          </MenubarRadioGroup>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  ),
};

/** 两档 `MenubarItem.variant`：`destructive` 把图标与文字一起染成危险色
 *  —— 与 dropdown-menu 同源，这里只是确认 menubar 也接上了。 */
export const ItemVariants: Story = {
  render: () => (
    <Menubar>
      <MenubarMenu>
        <MenubarTrigger>variant 两档</MenubarTrigger>
        <MenubarContent className="w-52">
          <MenubarItem>default</MenubarItem>
          <MenubarItem variant="destructive">destructive</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  ),
};

/** 横排联动：这一条是本件与 dropdown-menu 的**唯一实质差别** ——
 *  点开「文件」后把鼠标移到「编辑」，浮层会跟着换过去。 */
export const HoverSwitches: Story = {
  render: () => (
    <Menubar>
      {["文件", "编辑", "视图", "帮助"].map((label) => (
        <MenubarMenu key={label}>
          <MenubarTrigger>{label}</MenubarTrigger>
          <MenubarContent className="w-44">
            <MenubarItem>这一项属于「{label}」</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      ))}
    </Menubar>
  ),
};
