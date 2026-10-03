import type { Meta, StoryObj } from "@storybook/nextjs";

import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "~/components/ui/navigation-menu";

/**
 * `ui/navigation-menu` 是**站点级导航条**（悬停即展开的横向菜单）。
 *
 * 与 `menubar` 的差别值得说清，两者很容易被当成一件事：
 * - `menubar` 是**应用菜单栏**（`文件 / 编辑` 那种），点开、选一个、关掉；
 * - 本件是**导航**，悬停即展开，且展开的浮层由 `NavigationMenuPositioner`
 *   **统一承载**，所以移动鼠标时面板位置会平滑地跟着走 ——
 *   这是本件最值得看的一处形态，光看单项是看不出来的。
 *
 * 定位那一层同样读 `useOverlayBoundary()`（可用区域 = 视口减去应用级标题行，
 * 壳态才有标题行）。`NavigationMenuTrigger` 自带的 `ChevronDownIcon`
 * 会在展开时 `rotate-180`。
 */
const meta = {
  title: "UI/NavigationMenu",
  component: NavigationMenu,
} satisfies Meta<typeof NavigationMenu>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 两栏导航 + 一个「只有链接」的顶层项（不带 `Trigger`，直接是链接）。 */
export const Default: Story = {
  render: () => (
    <NavigationMenu>
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuTrigger>工作流</NavigationMenuTrigger>
          <NavigationMenuContent>
            <ul className="grid w-72 gap-1 p-2">
              {["全部工作流", "最近编辑", "导入的工作流"].map((label) => (
                <li key={label}>
                  <NavigationMenuLink href="#">{label}</NavigationMenuLink>
                </li>
              ))}
            </ul>
          </NavigationMenuContent>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <NavigationMenuTrigger>模型</NavigationMenuTrigger>
          <NavigationMenuContent>
            <ul className="grid w-72 gap-1 p-2">
              {["本地模型", "在线模型", "检查点"].map((label) => (
                <li key={label}>
                  <NavigationMenuLink href="#">{label}</NavigationMenuLink>
                </li>
              ))}
            </ul>
          </NavigationMenuContent>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <NavigationMenuLink href="#">文档</NavigationMenuLink>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  ),
};

/** 面板跟着鼠标横向滑动：这一条是本件与 `menubar` 的**核心差别** ——
 *  从一个触发器移到另一个，浮层位置是**平滑过渡**的（同一块面板换内容），
 *  而不是关掉再开一块新的。 */
export const PanelsSlideBetweenTriggers: Story = {
  render: () => (
    <NavigationMenu>
      <NavigationMenuList>
        {["一", "二", "三"].map((label) => (
          <NavigationMenuItem key={label}>
            <NavigationMenuTrigger>第{label}组</NavigationMenuTrigger>
            <NavigationMenuContent>
              <div className="w-56 p-3 text-sm">
                这是第{label}组的内容。把鼠标移到相邻的触发项上，
                会看到面板**滑过去**，而不是闪一下重开。
              </div>
            </NavigationMenuContent>
          </NavigationMenuItem>
        ))}
      </NavigationMenuList>
    </NavigationMenu>
  ),
};

/** `align` 两档：`start` / `center`，它决定浮层相对触发器的水平对位
 *  —— 两档并排放在一个窄容器里才看得出差别（宽容器下两者几乎重合）。 */
export const Alignments: Story = {
  render: () => (
    <div className="flex w-72 flex-col gap-6">
      {(["start", "center"] as const).map((align) => (
        <div key={align} className="flex flex-col gap-1.5">
          <span className="text-ink-muted font-mono text-[11px]">
            align={align}
          </span>
          <NavigationMenu align={align} className="justify-start">
            <NavigationMenuList>
              <NavigationMenuItem>
                <NavigationMenuTrigger>菜单</NavigationMenuTrigger>
                <NavigationMenuContent>
                  <ul className="grid w-64 gap-1 p-2">
                    <li>
                      <NavigationMenuLink href="#">第一项</NavigationMenuLink>
                    </li>
                    <li>
                      <NavigationMenuLink href="#">第二项</NavigationMenuLink>
                    </li>
                  </ul>
                </NavigationMenuContent>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>
        </div>
      ))}
    </div>
  ),
};
