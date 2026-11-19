import { FolderOpen, Home, Settings, Sparkles } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

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
 * `ui/sidebar` 是应用左轨（导航栏）的整套基元，也是唯一带编排纪律的一件。要看四件事：① `collapsible` 三档（`offcanvas` 滑走 / `icon` 收成 `size-8` 图标轨且 `SidebarGroupLabel` 隐掉 / `none` 常驻），收起才看得出；② 过 `NAV_AUTO_COLLAPSE_MAX_PX` 自动收成图标档，用户表态（连同跨越次数）再跨阈值即作废，生效态纯推导。
 * ③ `SidebarMenuButton` 两轴与 `tooltip`（仅收起且非移动端）；④ `SidebarInset` 与左轨是兄弟，受 `peer-data-[variant=inset]` 影响。三个宽度全部来自 `~/lib/layout-budget`，本文件不写字面量。
 */
/**
 * 两根轴（`variant` / `size`）住在 `SidebarMenuButton` 上，而 `Sidebar` 本体的轴是 `collapsible` / `variant` / `side` —— 同名轴在两处是不同的事。
 * `argTypes` 挂在真正生效的 `SidebarMenuButton` 那一组。
 */
type SidebarMenuButtonVariant = NonNullable<
  React.ComponentProps<typeof SidebarMenuButton>["variant"]
>;
type SidebarMenuButtonSize = NonNullable<React.ComponentProps<typeof SidebarMenuButton>["size"]>;

const MENU_BUTTON_VARIANTS: Array<SidebarMenuButtonVariant> = ["default", "outline"];
const MENU_BUTTON_SIZES: Array<SidebarMenuButtonSize> = ["default", "sm", "lg"];

const meta = {
  title: "UI/Sidebar",
  component: Sidebar,
  args: { children: null },
  /* SAFETY: 类型断言已复核 */
  argTypes: {
    variant: {
      control: {
        /* SAFETY: 类型断言已复核 */
        type: "select" as const,
      },
      options: MENU_BUTTON_VARIANTS,
    },
    size: {
      control: {
        /* SAFETY: 类型断言已复核 */
        type: "select" as const,
      },
      options: MENU_BUTTON_SIZES,
    },
  } as Record<string, { control: { type: "select" }; options: Array<string> }>,
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
  defaultOpen?: boolean;
  side?: "left" | "right";
  variant?: "sidebar" | "floating" | "inset";
}) {
  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <Sidebar collapsible={collapsible} side={side} variant={variant}>
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
            点左上角触发钮或按 ⌘/Ctrl+B 切换左轨 —— 收起时 `tooltip` 才出现（且非移动端）。
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
      <Shell collapsible="icon" variant="floating" />
    </div>
  ),
};

export const VariantInset: Story = {
  render: () => (
    <div className="h-128">
      <Shell collapsible="icon" variant="inset" />
    </div>
  ),
};

/** 右侧：`side="right"` 把整条移到右边（含收起方向与 `SidebarRail` 的
 *  贴边侧）—— 只看左侧是验不出这一档的。 */
export const SideRight: Story = {
  render: () => (
    <div className="h-128">
      <Shell collapsible="icon" side="right" />
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
      <Sidebar className="w-64" collapsible="none">
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {MENU_BUTTON_VARIANTS.map((variant) =>
                  MENU_BUTTON_SIZES.map((size) => (
                    <SidebarMenuItem key={`${variant}-${size}`}>
                      <SidebarMenuButton size={size} variant={variant}>
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
