"use client";

import { useState } from "react";
import { Settings2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "~/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { FullScreenDialog } from "~/components/ui/fullscreen-dialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "~/components/ui/hover-card";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarTrigger,
} from "~/components/ui/menubar";
import { OptionListPopover } from "~/components/ui/option-list-popover";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { SeedModeButton } from "~/components/ui/seed-mode-button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "~/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { GalleryCell, GalleryGrid, GallerySection } from "~/components/ui/ui-kit-gallery-parts";

/**
 * 浮层与对话框一组的演示（ISSUE #3525）。
 * 浮层是「背景色问题」的重灾区：壳与内容各有一层底色，遮罩还叠在页面之上 ——
 * 每一个都在明暗两态下开一次看。浮层层级与定位交给 Positioner / base-ui
 * （规范 16 §16.2.3.16 / §16.2.5），本页不做定位变体。
 */

/** ConfirmDialog 与 FullScreenDialog 都是纯受控件（不带触发器），各包一层小壳持开关状态。 */
function ControlledDialogsDemo() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  return (
    <>
      <Button
        onClick={() => {
          setConfirmOpen(true);
        }}
        variant="danger"
      >
        危险确认弹窗
      </Button>
      <Button
        onClick={() => {
          setFullscreenOpen(true);
        }}
        variant="outline"
      >
        全屏对话框
      </Button>
      <ConfirmDialog
        danger
        description="这一步会把草稿里的三张未保存草图一起清掉，且不可恢复。"
        onClose={() => {
          setConfirmOpen(false);
        }}
        onConfirm={() => {
          setConfirmOpen(false);
        }}
        open={confirmOpen}
        title="清空草稿？"
      />
      <FullScreenDialog
        label="全屏对话框演示"
        onOpenChange={setFullscreenOpen}
        open={fullscreenOpen}
      >
        <div className="p-6">
          <Button
            onClick={() => {
              setFullscreenOpen(false);
            }}
            variant="outline"
          >
            退出全屏
          </Button>
          <p className="mt-4 text-sm">全屏内容区。</p>
        </div>
      </FullScreenDialog>
    </>
  );
}

export function OverlaysSection() {
  return (
    <GallerySection
      note="每个浮层都开一次：壳底 / 内容底 / 遮罩三层在两态下各自检查。"
      title="浮层与对话框"
    >
      <GalleryGrid>
        <GalleryCell label="Dialog">
          <Dialog>
            <DialogTrigger render={<Button variant="outline" />}>打开对话框</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>对话框标题</DialogTitle>
                <DialogDescription>一句说明正文放这里。</DialogDescription>
              </DialogHeader>
              <p className="text-sm">内容区。</p>
              <DialogFooter>
                <Button variant="outline">取消</Button>
                <Button>确定</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </GalleryCell>
        <GalleryCell label="Sheet（侧滑面板）">
          <Sheet>
            <SheetTrigger render={<Button variant="outline" />}>打开侧板</SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>侧板标题</SheetTitle>
                <SheetDescription>侧板说明。</SheetDescription>
              </SheetHeader>
            </SheetContent>
          </Sheet>
        </GalleryCell>
        <GalleryCell label="FullScreenDialog / ConfirmDialog（受控）">
          <ControlledDialogsDemo />
        </GalleryCell>
        <GalleryCell label="Popover / Tooltip / HoverCard">
          <Popover>
            <PopoverTrigger render={<Button variant="outline" />}>气泡</PopoverTrigger>
            <PopoverContent className="w-56">
              <p className="text-sm">气泡内容。</p>
            </PopoverContent>
          </Popover>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" />}>悬停我</TooltipTrigger>
            <TooltipContent>一条提示</TooltipContent>
          </Tooltip>
          <HoverCard>
            <HoverCardTrigger render={<Button variant="ghost" />}>卡片悬浮</HoverCardTrigger>
            <HoverCardContent className="w-56">
              <p className="text-sm">悬浮卡内容。</p>
            </HoverCardContent>
          </HoverCard>
        </GalleryCell>
        <GalleryCell label="DropdownMenu / ContextMenu（右键）">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" />}>菜单</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>分组标题</DropdownMenuLabel>
              <DropdownMenuItem>重命名</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">删除</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ContextMenu>
            <ContextMenuTrigger className="border-border text-ink-muted flex h-16 w-32 items-center justify-center rounded-lg border border-dashed text-xs select-none">
              在这右键
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem>复制</ContextMenuItem>
              <ContextMenuItem variant="destructive">删除</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </GalleryCell>
        <GalleryCell label="Menubar / Command（内嵌）">
          <Menubar>
            <MenubarMenu>
              <MenubarTrigger>文件</MenubarTrigger>
              <MenubarContent>
                <MenubarItem>新建</MenubarItem>
                <MenubarItem>导入</MenubarItem>
              </MenubarContent>
            </MenubarMenu>
            <MenubarMenu>
              <MenubarTrigger>编辑</MenubarTrigger>
              <MenubarContent>
                <MenubarItem>撤销</MenubarItem>
              </MenubarContent>
            </MenubarMenu>
          </Menubar>
          <Command className="border-border w-64 rounded-lg border">
            <CommandInput placeholder="搜索…" />
            <CommandList>
              <CommandEmpty>没有匹配</CommandEmpty>
              <CommandGroup heading="动作">
                <CommandItem>打开项目</CommandItem>
                <CommandItem>导出成片</CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </GalleryCell>
        <GalleryCell label="OptionListPopover / SeedModeButton">
          <OptionListPopover
            items={[
              { value: "local", label: "本地模型" },
              { value: "remote", label: "在线模型" },
            ]}
            onSelect={() => undefined}
            trigger={
              <Button aria-label="选择模型" size="icon-sm" variant="outline">
                <Settings2 aria-hidden />
              </Button>
            }
            value="local"
          />
          <SeedModeButton mode="fixed" onPick={() => undefined} />
        </GalleryCell>
      </GalleryGrid>
    </GallerySection>
  );
}
