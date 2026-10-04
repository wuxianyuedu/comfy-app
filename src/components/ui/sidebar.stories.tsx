import { FolderOpen, Home, Settings, Sparkles } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/nextjs";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from "~/components/ui/sidebar";

/**
 * `ui/sidebar` 是**应用左轨**（导航栏）的整套基元 —— 全库最大的一件，
 * 也是唯一一件「自己不只是一块 UI」的：它带**一套编排纪律**。
 *
 * ## 要看的四件事
 *
 * 1. **`collapsible` 三档**：`offcanvas`（整条滑走）/ `icon`（收成图标轨，
 *    `size-8` 且 `SidebarGroupLabel` 会 `-mt-8 opacity-0` 隐掉）/
 *    `none`（永远铺着）。三档之间的差别只有真收起才看得出 ——
 *    点左上角的触发钮，或按 **⌘/Ctrl+B**。
 * 2. **自动收起是「纪律」而不是「用户偏好」**：窗口跨过
 *    `NAV_AUTO_COLLAPSE_MAX_PX` 时 `resolveRailCollapsed` 会把轨收成图标档，
 *    而**用户自己点**的那一档记在 `choice`（连同当时的跨越次数）里 ——
 *    再跨一次阈值即作废，所以生效态是纯推导、不需要 effect 清理标记。
 *    这也决定了 cookie 只写「用户表态」的那一次。
 * 3. **`SidebarMenuButton` 的两根轴**（`variant` / `size`），
 *    以及 `tooltip` —— 它只在**收起且非移动端**时才显示
 *    （`hidden={state !== "collapsed" || isMobile}`）。
 * 4. **`SidebarInset`**：主内容区的那一列（`main`），与左轨是兄弟 ——
 *    它带 `peer-data-[variant=inset]` 一族，改左轨的 `variant` 会影响它。
 *
 * ## 宽度从哪来
 *
 * 三个宽度（展开 / 收起 / 移动端）全部来自 `~/lib/layout-budget`，本文件不写
 * 字面量 —— 它们同时是「左轨何时该自动收起」那笔账的加数
 * （`layout-budget.test.ts` 反算钉住）。
 */
/**
 * 两根轴（`variant` / `size`）住在 `SidebarMenuButton` 上，而 `Sidebar` 本体
 * 的轴是 `collapsible` / `variant` / `side` —— 同名轴在两处是**不同的事**。
 * `argTypes` 是「哪个清单属于哪个轴」的显式链接，所以这两条挂在
 * `SidebarMenuButton` 那一组（那正是它们真正生效的地方）。
 */
type SidebarMenuButtonVariant = NonNullable<
  React.ComponentProps<typeof SidebarMenuButton>["variant"]
>;
type SidebarMenuButtonSize = NonNullable<
  React.ComponentProps<typeof SidebarMenuButton>["size"]
>;

const MENU_BUTTON_VARIANTS: SidebarMenuButtonVariant[] = ["default", "outline"];
const MENU_BUTTON_SIZES: SidebarMenuButtonSize[] = ["default", "sm", "lg"];

const meta = {
  title: "UI/Sidebar",
  component: Sidebar,
  args: { children: null },
  argTypes: {
    variant: {
      control: { type: "select" as const },
      options: MENU_BUTTON_VARIANTS,
    },
    size: {
      control: { type: "select" as const },
      options: MENU_BUTTON_SIZES,
    },
  } as Record<string, { control: { type: "select" }; options: string[] }>,
} satisfies Meta<typeof Sidebar>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 一份完整左轨：Provider + Header/Content/Footer + 三组菜单
 *  （含 `Sub` / `Action` / `Badge` / 骨架）。 */
function Shell({
  collapsible = "icon",
  variant = "sidebar",
  side = "left",
  defaultOpen = true,
}: {
  collapsible?: "offcanvas" | "icon" | "none";
  variant?: "sidebar" | "floating" | "inset";
  side?: "left" | "right";
  defaultOpen?: boolean;
}) {
  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <Sidebar collapsible={collapsible} variant={variant} side={side}>
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg">
                <Sparkles />
                <span>Comfy APP</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>主要</SidebarGroupLabel>
            <SidebarGroupAction aria-label="新建" title="新建">
              <Sparkles />
            </SidebarGroupAction>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive tooltip="工作区">
                    <Home />
                    <span>工作区</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="工作流库">
                    <FolderOpen />
                    <span>工作流库</span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge>12</SidebarMenuBadge>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarSeparator />
          <SidebarGroup>
            <SidebarGroupLabel>设置</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="设置">
                    <Settings />
                    <span>设置</span>
                  </SidebarMenuButton>
                  <SidebarMenuSub>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton isActive>通用</SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton>存储</SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuSkeleton showIcon />
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="sm">
                <Settings />
                <span>v0.1.0</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <div className="flex items-center gap-2 border-b p-2">
          <SidebarTrigger />
          <span className="text-sm">主内容区（SidebarInset）</span>
        </div>
        <div className="p-4">
          <p className="text-ink-muted text-sm">
            点左上角触发钮或按 ⌘/Ctrl+B 切换左轨 —— 收起时 `tooltip`
            才出现（且非移动端）。
          </p>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

/** 完整左轨（`collapsible="icon"`）：点触发钮看它收成图标轨 ——
 *  `SidebarGroupLabel` 那两行会隐掉（`-mt-8 opacity-0`）。 */
export const Default: Story = {
  render: (args) => (
    <div className="h-128">
      <Shell collapsible={args.children === null ? "icon" : "icon"} />
    </div>
  ),
};

/** 三档 `collapsible` 并列（在同一个画布里会互相干扰，所以逐条给）：
 *  `offcanvas` 整条滑走 / `icon` 收成图标轨 / `none` 永远铺着。 */
export const CollapsibleOffcanvas: Story = {
  render: () => (
    <div className="h-128">
      <Shell collapsible="offcanvas" />
    </div>
  ),
};

export const CollapsibleIcon: Story = {
  render: () => (
    <div className="h-128">
      <Shell collapsible="icon" />
    </div>
  ),
};

export const CollapsibleNone: Story = {
  render: () => (
    <div className="h-128">
      <Shell collapsible="none" />
    </div>
  ),
};

/** `variant` 三档：`sidebar`（普通）/ `floating`（浮起的卡片）/ `inset`
 *  （左轨与内容区之间留白，`SidebarInset` 那侧跟着变）—— 最后一档之所以要看，
 *  是因为它同时改**两块**的形态（`peer-data-[variant=inset]` 一族）。 */
export const VariantFloating: Story = {
  render: () => (
    <div className="h-128">
      <Shell variant="floating" collapsible="icon" />
    </div>
  ),
};

export const VariantInset: Story = {
  render: () => (
    <div className="h-128">
      <Shell variant="inset" collapsible="icon" />
    </div>
  ),
};

/** 右侧：`side="right"` 把整条移到右边（含收起方向与 `SidebarRail` 的
 *  贴边侧）—— 只看左侧是验不出这一档的。 */
export const SideRight: Story = {
  render: () => (
    <div className="h-128">
      <Shell side="right" collapsible="icon" />
    </div>
  ),
};

/** 默认收起：`defaultOpen={false}` 就是「用户上次收起过」的形态
 *  （真实入口由服务端读 cookie 传给 `defaultOpen`，首屏即这一档）。 */
export const DefaultCollapsed: Story = {
  render: () => (
    <div className="h-128">
      <Shell collapsible="icon" defaultOpen={false} />
    </div>
  ),
};

/** `SidebarMenuButton` 两轴（`variant` × `size`）+ `isActive`：
 *  `variant="outline"` 带描边；`size="lg"` 是 `h-12`（品牌行用）；
 *  `isActive` 给选中底色与左侧那条 `before:` 竖条。 */
export const MenuButtonAxes: Story = {
  render: () => (
    <SidebarProvider>
      <Sidebar collapsible="none" className="w-64">
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {MENU_BUTTON_VARIANTS.map((variant) =>
                  MENU_BUTTON_SIZES.map((size) => (
                    <SidebarMenuItem key={`${variant}-${size}`}>
                      <SidebarMenuButton variant={variant} size={size}>
                        <Home />
                        <span>
                          {variant} / {size}
                        </span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )),
                )}
                <SidebarMenuItem>
                  <SidebarMenuButton isActive>
                    <Home />
                    <span>isActive（有左侧竖条）</span>
                  </SidebarMenuButton>
                  <SidebarMenuAction aria-label="更多" title="更多">
                    <Settings />
                  </SidebarMenuAction>
                  <SidebarMenuBadge>3</SidebarMenuBadge>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  ),
};
