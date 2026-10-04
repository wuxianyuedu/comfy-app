import { useState } from "react";
import { FolderOpen, Play, Settings, Trash2 } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/nextjs";

import { Button } from "~/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "~/components/ui/command";

/**
 * `ui/command` 是 cmdk 的封装（**命令面板**：搜索 + 键盘上下选 + 回车执行）。
 *
 * 这一族有一条**结构上的硬约束**，只有打开面板才暴露：
 * `CommandInput` / `CommandList` / `CommandItem` / `CommandGroup` /
 * `CommandEmpty` **全都从 `<Command>` 的 context 里读 store**
 * （cmdk 的 `useCmdk` 直接解引用 `store.subscribe`）。所以
 * `CommandDialog` 内部必须套一层 `<Command>` —— 这条曾经漏过，表现是
 * 「打开面板就抛 `Cannot read properties of undefined (reading 'subscribe')`」，
 * 而**关闭时看不出来**（base-ui 的 `Dialog.Portal` 不渲染子节点）。
 * 因此下面每条 story 都先把面板真的打开一次。
 *
 * 另一处只有渲染才看得出：`CommandItem` 的勾选图标与 `CommandShortcut` 是
 * **互斥**的（`group-has-data-[slot=command-shortcut]/command-item:hidden`）——
 * 同一项既有快捷键又是勾选项时，只会显示快捷键。
 */
const meta = {
  title: "UI/Command",
  component: Command,
} satisfies Meta<typeof Command>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 面板外的内联形态：`<Command>` 直接铺在页面里（命令面板也可以不是弹窗）。 */
export const Inline: Story = {
  render: () => (
    <div className="w-lg rounded-lg border">
      <Command>
        <CommandInput placeholder="搜索要执行的命令…" />
        <CommandList>
          <CommandEmpty>没有匹配的命令</CommandEmpty>
          <CommandGroup heading="工作流">
            <CommandItem>
              <Play /> 运行当前工作流
              <CommandShortcut>⌘↵</CommandShortcut>
            </CommandItem>
            <CommandItem>
              <FolderOpen /> 打开工作流库
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="设置">
            <CommandItem>
              <Settings /> 打开设置
            </CommandItem>
            <CommandItem>
              <Trash2 /> 清空画布
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  ),
};

/**
 * `CommandDialog`：**打开**才渲染内部（这正是上面那条硬约束藏得住的原因）
 * —— 所以这一档是判据的现场，画布上必须点开。默认文案「命令面板」
 * 由 `title` 给，`showCloseButton` 默认 `false`（面板自己有关闭出口）。
 */
export const InDialog: Story = {
  render: () => <DialogDemo />,
};

function DialogDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        打开命令面板（⌘K）
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="搜索要执行的命令…" />
        <CommandList>
          <CommandEmpty>没有匹配的命令</CommandEmpty>
          <CommandGroup heading="工作流">
            <CommandItem>
              <Play /> 运行当前工作流
              <CommandShortcut>⌘↵</CommandShortcut>
            </CommandItem>
            <CommandItem>
              <FolderOpen /> 打开工作流库
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="设置">
            <CommandItem onSelect={() => setOpen(false)}>
              <Settings /> 打开设置
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}

/** 空态：搜到一个不存在的词时 `CommandEmpty` 才出现 —— 它是「这个面板不是
 *  坏了」的唯一出口（规范 10.5）。打开面板后输入 `zzz` 看这一档。 */
export const Empty: Story = {
  render: () => (
    <div className="w-lg rounded-lg border">
      <Command>
        <CommandInput placeholder="输入 zzz 看空态…" />
        <CommandList>
          <CommandEmpty>没有匹配的命令</CommandEmpty>
          <CommandGroup heading="工作流">
            <CommandItem>运行当前工作流</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  ),
};

/** 快捷键与勾选互斥：`CommandShortcut` 出现的那一项**不会**显示左侧的
 *  勾选图标（`group-has-data-[slot=command-shortcut]/command-item:hidden`）
 *  —— 两档并排才看得出这条规则。 */
export const ShortcutVsChecked: Story = {
  render: () => (
    <div className="w-lg rounded-lg border">
      <Command>
        <CommandInput placeholder="看两种项的区别…" />
        <CommandList>
          <CommandGroup heading="有快捷键">
            <CommandItem>
              运行当前工作流
              <CommandShortcut>⌘↵</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="无快捷键（勾选图标有位）">
            <CommandItem data-checked="true">显示侧栏</CommandItem>
            <CommandItem>显示状态栏</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  ),
};

/** 禁用项：`disabled` 的项不可选、跳过键盘上下（`data-disabled`）。 */
export const WithDisabled: Story = {
  render: () => (
    <div className="w-lg rounded-lg border">
      <Command>
        <CommandInput placeholder="试试方向键…" />
        <CommandList>
          <CommandGroup heading="可执行">
            <CommandItem>运行当前工作流</CommandItem>
            <CommandItem disabled>
              <Trash2 /> 清空画布（运行中，禁用）
            </CommandItem>
            <CommandItem>
              <Settings /> 打开设置
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  ),
};
