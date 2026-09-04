"use client";

/** extracted from ProjectCanvas's top-left project
 *  switcher (button + dropdown).  Controlled by the parent — all menu /
 *  rename state lives in useProjectManager and is threaded through props.
 */
import { Icon } from "@/components/ui/icon";

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
        className="flex items-center gap-2 rounded-full border border-white/10 bg-linear-to-br from-[#1a1530]/85 to-[#16121f]/85 px-3.5 py-1.5 text-[12px] font-medium text-gray-100 shadow-lg shadow-black/30 backdrop-blur-md transition-all hover:border-violet-400/40 hover:shadow-violet-500/15"
        onClick={onToggleMenu}
        title="项目列表"
      >
        <span className="text-violet-300">▦</span>
        <span className="max-w-[160px] truncate">{projectName}</span>
        <span className="text-gray-500">▾</span>
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={onCloseMenu} />
          <div className="absolute top-10 left-0 z-40 w-60 overflow-hidden rounded-xl border border-white/10 bg-[#14121f]/95 p-1.5 shadow-2xl shadow-black/60 backdrop-blur">
            <div className="px-2 py-1 text-[10px] tracking-wider text-gray-500 uppercase">
              我的画布项目
            </div>
            <div className="max-h-56 overflow-auto">
              {projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => onSwitch(project.id)}
                  className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-white/6 ${
                    project.id === projectId
                      ? "text-violet-300"
                      : "text-gray-200"
                  }`}
                >
                  <span className="truncate">{project.name}</span>
                  {project.id === projectId && (
                    <span className="text-[10px] text-violet-400">当前</span>
                  )}
                </button>
              ))}
              {projects.length === 0 && (
                <p className="px-2 py-1.5 text-[11px] text-gray-500">
                  暂无其他项目
                </p>
              )}
            </div>
            <div className="my-1 h-px bg-white/6" />
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
                  className="w-full rounded-md border border-white/8 bg-black/30 px-2 py-1 text-[12px] text-gray-200 outline-none focus:border-violet-400/60"
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
                    className="flex-1 rounded-md border border-white/8 px-2 py-1 text-[11px] text-gray-300 hover:bg-white/6"
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
                  className="rounded-lg px-2 py-1.5 text-left text-[12px] text-gray-200 transition-colors hover:bg-white/6"
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
                  className="rounded-lg px-2 py-1.5 text-left text-[12px] text-gray-200 transition-colors hover:bg-white/6"
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
                  className="rounded-lg px-2 py-1.5 text-left text-[12px] text-red-400 transition-colors hover:bg-red-400/8"
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
