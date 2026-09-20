"use client";

/** 从 ProjectCanvas 的左上角项目切换器（按钮 + 下拉）抽出（ISSUE #672 /
 *  规范 16 §16.2.4.6 第一档：接 `ui/dropdown-menu`）。
 *
 *  受父级控制 —— 菜单 / 重命名状态都在 useProjectManager 里并经 props 传入。
 *  换基元前这里也是自绘外壳：`absolute top-10` 手定位 + 自绘遮罩负责关闭 +
 *  手写分组标签与分隔线，没有 `role="menu"` / Esc / 方向键。现在这些由
 *  base-ui 的 `Menu` 给，调用处那份手写语义随之删除。
 *
 *  `modal={false}`：菜单里带着重命名输入框，需要能聚焦它且不锁页面滚动。
 */
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { enterCommit } from "~/components/ui/use-enter-commit";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

interface ProjectSwitcherProps {
  projectName: string;
  projectId: string | null;
  projects: Array<{ id: string; name: string }>;
  menuOpen: boolean;
  renaming: boolean;
  renameVal: string;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onSwitch: (id: string) => void;
  onNew: () => void;
  onStartRename: () => void;
  onRenameValChange: (v: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onDelete: () => void;
}

export function ProjectSwitcher({
  projectName,
  projectId,
  projects,
  menuOpen,
  renaming,
  renameVal,
  onToggleMenu,
  onCloseMenu,
  onSwitch,
  onNew,
  onStartRename,
  onRenameValChange,
  onCommitRename,
  onCancelRename,
  onDelete,
}: ProjectSwitcherProps) {
  return (
    <DropdownMenu
      open={menuOpen}
      onOpenChange={(open) => {
        if (open === menuOpen) return;
        /* 开：交回 hook 的 openProjMenu（它会先刷新项目列表）；
           关：走 onCloseMenu。 */
        if (open) onToggleMenu();
        else onCloseMenu();
      }}
      modal={false}
    >
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="border-border-strong from-subtle to-surface-2 text-ink-bright flex h-auto items-center gap-2 rounded-full border bg-linear-to-br px-3.5 py-1.5 text-[12px] font-medium shadow-lg shadow-black/30 backdrop-blur-md transition-all hover:border-violet-400/40 hover:shadow-violet-500/15"
            title="项目列表"
          />
        }
      >
        <span className="text-violet-700 dark:text-violet-300">▦</span>
        <span className="max-w-[160px] truncate">{projectName}</span>
        <span className="text-ink-muted">▾</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        className="border-border-strong bg-panel/95 w-60 overflow-hidden rounded-xl border p-1.5 shadow-2xl shadow-black/20 backdrop-blur dark:shadow-black/60"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-ink-muted px-2 py-1 text-[10px] tracking-wider uppercase">
            我的画布项目
          </DropdownMenuLabel>
          <div className="max-h-56 overflow-auto">
            {projects.map((project) => (
              <DropdownMenuItem
                key={project.id}
                onClick={() => onSwitch(project.id)}
                className={`focus:bg-subtle flex items-center justify-between rounded-lg px-2 py-1.5 text-left text-[12px] ${
                  project.id === projectId
                    ? "text-violet-700 dark:text-violet-300"
                    : "text-ink-bright"
                }`}
              >
                <span className="truncate">{project.name}</span>
                {project.id === projectId && (
                  <span className="text-[10px] text-violet-700 dark:text-violet-400">
                    当前
                  </span>
                )}
              </DropdownMenuItem>
            ))}
            {projects.length === 0 && (
              <p className="text-ink-muted px-2 py-1.5 text-[11px]">
                暂无其他项目
              </p>
            )}
          </div>
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="bg-border-strong" />
        {renaming ? (
          <div className="space-y-1 p-1">
            <input
              autoFocus
              value={renameVal}
              onChange={(event) => onRenameValChange(event.target.value)}
              {...enterCommit({
                onCommit: onCommitRename,
                onCancel: onCancelRename,
              })}
              className="border-border-strong bg-canvas-deep text-ink-bright w-full rounded-md border px-2 py-1 text-[12px] outline-none focus:border-violet-400/60"
              placeholder="项目名称"
            />
            <div className="flex gap-1">
              <Button
                variant="primary-solid"
                size="xs"
                className="h-auto flex-1 rounded-md px-2 py-1 text-[11px]"
                onClick={onCommitRename}
              >
                保存
              </Button>
              <Button
                variant="outline"
                size="xs"
                className="border-border-strong text-ink-soft hover:bg-subtle h-auto flex-1 rounded-md px-2 py-1 text-[11px]"
                onClick={onCancelRename}
              >
                取消
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col">
            <DropdownMenuItem
              onClick={onNew}
              className="text-ink-bright focus:bg-subtle justify-start rounded-lg px-2 py-1.5 text-left text-[12px]"
            >
              <Icon name="plus" size={13} className="mr-1.5" />
              新建项目
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onStartRename}
              className="text-ink-bright focus:bg-subtle justify-start rounded-lg px-2 py-1.5 text-left text-[12px]"
            >
              <Icon name="pen" size={13} className="mr-1.5" />
              重命名当前
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onDelete}
              className="justify-start rounded-lg px-2 py-1.5 text-left text-[12px] text-red-700 focus:bg-red-500/10 dark:text-red-400"
            >
              <Icon name="trash" size={13} className="mr-1.5" />
              删除当前
            </DropdownMenuItem>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
