"use client";

import Link from "next/link";
import { Cloud, Home, Images } from "lucide-react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "~/components/ui/breadcrumb";
import { BreadcrumbPath } from "~/components/ui/breadcrumb-path";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "~/components/ui/navigation-menu";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "~/components/ui/pagination";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "~/components/ui/resizable";
import { ScrollArea, ScrollBar } from "~/components/ui/scroll-area";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "~/components/ui/sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { GalleryCell, GalleryGrid, GallerySection } from "~/components/ui/ui-kit-gallery-parts";

/**
 * 导航与布局一组的演示（ISSUE #3525）。
 * 导航件自带「选中 / 悬停 / 当前页」三档状态色，是 nav-* 与 sidebar-* 那组
 * token 的直接消费者；侧栏给一版缩小样（真实侧栏在 AppShell 里）。
 */

export function NavigationSection() {
  return (
    <GallerySection
      note="导航件的三档状态色（默认 / 悬停 / 选中）逐档看，当前页与选中项最容易错。"
      title="导航与布局"
    >
      <GalleryGrid>
        <GalleryCell label="Tabs">
          <Tabs defaultValue="tab-a">
            <TabsList>
              <TabsTrigger value="tab-a">画布</TabsTrigger>
              <TabsTrigger value="tab-b">历史</TabsTrigger>
              <TabsTrigger value="tab-c">队列</TabsTrigger>
            </TabsList>
            <TabsContent value="tab-a">
              <p className="text-ink-muted text-xs">第一个页签的内容。</p>
            </TabsContent>
          </Tabs>
        </GalleryCell>
        <GalleryCell label="Breadcrumb（shadcn）">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="#">项目</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink href="#">分镜</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>第 3 镜</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </GalleryCell>
        <GalleryCell label="BreadcrumbPath（可导航路径）">
          <BreadcrumbPath
            onNavigate={() => undefined}
            segments={[
              { key: "project", label: "我的项目" },
              { key: "assets", label: "素材库" },
              { key: null, label: "角色" },
            ]}
          />
        </GalleryCell>
        <GalleryCell label="Pagination">
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious href="#" />
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#">1</PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#" isActive>
                  2
                </PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#">3</PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationNext href="#" />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </GalleryCell>
        <GalleryCell label="NavigationMenu">
          <NavigationMenu>
            <NavigationMenuList>
              <NavigationMenuItem>
                <NavigationMenuTrigger>创作</NavigationMenuTrigger>
                <NavigationMenuContent>
                  <p className="w-56 p-3 text-sm">从这里进入工坊与画布。</p>
                </NavigationMenuContent>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuTrigger render={<Link aria-label="资源库" href="/models" />}>
                  资源库
                </NavigationMenuTrigger>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>
        </GalleryCell>
        <GalleryCell label="ScrollArea / Resizable">
          <ScrollArea className="h-20 w-48 rounded-lg border">
            <div className="flex flex-col gap-1 p-2 text-xs">
              <span>滚动内容第一行</span>
              <span>滚动内容第二行</span>
              <span>滚动内容第三行</span>
              <span>滚动内容第四行</span>
              <span>滚动内容第五行</span>
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
          <ResizablePanelGroup className="h-20 w-full rounded-lg border" orientation="horizontal">
            <ResizablePanel defaultSize={50}>
              <div className="flex h-full items-center justify-center text-xs">左栏</div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={50}>
              <div className="flex h-full items-center justify-center text-xs">右栏</div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </GalleryCell>
        <GalleryCell className="col-span-full" label="Sidebar（缩小样，真实侧栏在 AppShell）">
          <div className="bg-bg flex h-64 overflow-hidden rounded-lg border">
            <SidebarProvider className="min-h-0">
              <Sidebar className="h-64" collapsible="none">
                <SidebarHeader>
                  <span className="text-sm font-semibold">工作区</span>
                </SidebarHeader>
                <SidebarContent>
                  <SidebarGroup>
                    <SidebarGroupLabel>创作</SidebarGroupLabel>
                    <SidebarGroupContent>
                      <SidebarMenu>
                        <SidebarMenuItem>
                          <SidebarMenuButton isActive>
                            <Home aria-hidden />
                            首页
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                        <SidebarMenuItem>
                          <SidebarMenuButton>
                            <Images aria-hidden />
                            产出
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      </SidebarMenu>
                    </SidebarGroupContent>
                  </SidebarGroup>
                </SidebarContent>
              </Sidebar>
              <SidebarInset>
                <div className="flex h-full items-center justify-center">
                  <span className="flex items-center gap-1.5 text-xs">
                    <Cloud aria-hidden className="size-3.5" />
                    主内容面
                  </span>
                </div>
              </SidebarInset>
            </SidebarProvider>
          </div>
        </GalleryCell>
      </GalleryGrid>
    </GallerySection>
  );
}
