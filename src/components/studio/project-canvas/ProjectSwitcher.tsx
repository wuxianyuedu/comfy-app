"use client";

/** extracted from ProjectCanvas's top-left project
 *  switcher (button + dropdown).  Controlled by the parent — all menu /
 *  rename state lives in useProjectManager and is threaded through props.
 */
import { Icon } from "~/components/ui/icon";
import { overlayClass } from "~/lib/full-screen-layer";

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
    <div className="relative">
      <button
        className="border-border-strong from-subtle to-surface-2 text-ink-bright flex items-center gap-2 rounded-full border bg-linear-to-br px-3.5 py-1.5 text-[12px] font-medium shadow-lg shadow-black/30 backdrop-blur-md transition-all hover:border-violet-400/40 hover:shadow-violet-500/15"
        onClick={onToggleMenu}
        title="项目列表"
      >
        <span className="text-violet-700 dark:text-violet-300">▦</span>
        <span className="max-w-[160px] truncate">{projectName}</span>
        <span className="text-ink-muted">▾</span>
      </button>
      {menuOpen && (
        <>
          <div
            className={overlayClass("modal", "z-30")}
            onClick={onCloseMenu}
          />
          <div className="border-border-strong bg-panel/95 absolute top-10 left-0 z-40 w-60 overflow-hidden rounded-xl border p-1.5 shadow-2xl shadow-black/20 backdrop-blur dark:shadow-black/60">
            <div className="text-ink-muted px-2 py-1 text-[10px] tracking-wider uppercase">
              我的画布项目
            </div>
            <div className="max-h-56 overflow-auto">
              {projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => onSwitch(project.id)}
                  className={`hover:bg-subtle flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors ${
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
                </button>
              ))}
              {projects.length === 0 && (
                <p className="text-ink-muted px-2 py-1.5 text-[11px]">
                  暂无其他项目
                </p>
              )}
            </div>
            <div className="bg-border-strong my-1 h-px" />
            {renaming ? (
              <div className="space-y-1 p-1">
                <input
                  autoFocus
                  value={renameVal}
                  onChange={(event) => onRenameValChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") onCommitRename();
                    if (event.key === "Escape") onCancelRename();
                  }}
                  className="border-border-strong bg-canvas-deep text-ink-bright w-full rounded-md border px-2 py-1 text-[12px] outline-none focus:border-violet-400/60"
                  placeholder="项目名称"
                />
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="flex-1 rounded-md bg-violet-500/90 px-2 py-1 text-[11px] text-white hover:bg-violet-500"
                    onClick={onCommitRename}
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    className="border-border-strong text-ink-soft hover:bg-subtle flex-1 rounded-md border px-2 py-1 text-[11px]"
                    onClick={onCancelRename}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col">
                <button
                  type="button"
                  onClick={onNew}
                  className="text-ink-bright hover:bg-subtle rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors"
                >
                  <Icon
                    name="plus"
                    size={13}
                    className="mr-1.5 inline align-[-2px]"
                  />
                  新建项目
                </button>
                <button
                  type="button"
                  onClick={onStartRename}
                  className="text-ink-bright hover:bg-subtle rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors"
                >
                  <Icon
                    name="pen"
                    size={13}
                    className="mr-1.5 inline align-[-2px]"
                  />
                  重命名当前
                </button>
                <button
                  type="button"
                  onClick={onDelete}
                  className="rounded-lg px-2 py-1.5 text-left text-[12px] text-red-700 transition-colors hover:bg-red-500/10 dark:text-red-400"
                >
                  <Icon
                    name="trash"
                    size={13}
                    className="mr-1.5 inline align-[-2px]"
                  />
                  删除当前
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
