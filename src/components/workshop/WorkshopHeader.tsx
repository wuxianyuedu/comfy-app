"use client";

// 工坊顶栏：项目切换器、项目标识、总进度、模型适配 / 模式契约两个入口。
// 纯展示，数据由 controller 下发。
//
// 两个入口是并列的（ISSUE #597）：模型适配 = 每个远端模型 × 每个模式的字段映射；
// 模式契约 = 每种模式对外有哪些统一输入 / 输出。后者在工作流库也有一份。

import { useCallback, useEffect, useRef, useState } from "react";
import { textHandler } from "~/lib/form-props";

import { Button } from "~/components/ui/button";
import { Icon } from "~/components/ui/icon";
import { ProgressBar } from "~/components/ui/progress-bar";
import type { ApiChannelsView } from "~/lib/workshop/api-channel-shared";
import type { WorkshopProjectSummary } from "./hooks/use-workshop-pipeline";
import { zClass } from "~/lib/shell/overlay-z";
import { useHotkey } from "~/components/ui/use-hotkey";
import { enterCommit } from "~/components/ui/use-enter-commit";

interface WorkshopHeaderProps {
  title: string;
  progressPct: number;
  pendingCategories: number;
  apiChannels: ApiChannelsView | null;
  onOpenApiSettings: () => void;
  onOpenModeContract: () => void;
  /* ── 多项目切换 ── */
  projects: WorkshopProjectSummary[];
  activeProjectId: string;
  onSwitchProject: (id: string) => void;
  onCreateProject: (title?: string) => void;
  onRenameProject: (id: string, title: string) => void;
  onDeleteProject: (id: string) => void;
}

export function WorkshopHeader({
  title,
  progressPct,
  pendingCategories,
  apiChannels,
  onOpenApiSettings,
  onOpenModeContract,
  projects,
  activeProjectId,
  onSwitchProject,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
}: WorkshopHeaderProps) {
  const anyChannelConfigured =
    apiChannels?.image.configured === true ||
    apiChannels?.video.configured === true;

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  /* 点击外部 / Esc 关闭下拉，避免菜单常驻遮挡画布。 */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setEditingId(null);
        setCreating(false);
        setPendingDelete(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  /* Esc 关闭下拉（与上面的「点击外部」是一对）。`filterInput: false` ——
   * 用户可能正在改名输入框里按 Esc 放弃编辑，那时也要关掉菜单。 */
  const closeMenu = useCallback(() => {
    setOpen(false);
    setEditingId(null);
    setCreating(false);
    setPendingDelete(null);
  }, []);
  useHotkey({ key: "Escape" }, closeMenu, {
    enabled: open,
    filterInput: false,
    target: document,
  });

  const commitRename = (id: string) => {
    const next = draftTitle.trim();
    if (next) onRenameProject(id, next);
    setEditingId(null);
  };

  const commitCreate = () => {
    const next = draftTitle.trim();
    onCreateProject(next || undefined);
    setCreating(false);
    setDraftTitle("");
    setOpen(false);
  };

  return (
    <header className="border-border flex h-16 items-center gap-3 border-b px-6">
      <div className="flex flex-1 items-center gap-3">
        <div className="bg-primary grid h-9 w-9 place-items-center rounded-xl text-base font-bold text-white">
          工
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-ink text-[17px] font-semibold">
            工坊 · 全链路项目管线
          </span>
          <span className="text-muted-foreground text-[11px]">
            Comfy-APP / 项目管线
          </span>
        </div>

        {/* ── 项目切换器 ── */}
        <div className="relative ml-2" ref={menuRef}>
          <Button
            variant="outline"
            onClick={() => setOpen((v) => !v)}
            className="text-ink hover:bg-primary/10 border-border bg-subtle h-auto max-w-[240px] gap-2 rounded-lg px-3 py-1.5"
            title="切换 / 新建 / 重命名项目"
          >
            <span className="truncate text-[13px] font-medium">{title}</span>
            <span className="text-muted-foreground shrink-0 text-[10px]">
              {projects.length} 个项目
            </span>
            <span className="text-muted-foreground shrink-0 text-[10px]">
              {open ? "▲" : "▼"}
            </span>
          </Button>

          {open && (
            <div
              className={`border-border bg-panel/98 absolute top-full left-0 ${zClass("popup")} mt-1.5 w-[280px] overflow-hidden rounded-xl border shadow-2xl backdrop-blur-md`}
            >
              <div className="max-h-[280px] overflow-y-auto py-1">
                {projects.map((p) => {
                  const active = p.id === activeProjectId;
                  const shown = active ? title : p.title;
                  return (
                    <div
                      key={p.id}
                      className="group hover:bg-surface-2 flex items-center gap-1 px-2 py-1.5"
                    >
                      {pendingDelete === p.id ? (
                        <div className="flex w-full items-center gap-2">
                          <span className="text-muted-foreground flex-1 truncate text-[12px]">
                            删除「{shown}」？
                          </span>
                          <Button
                            variant="danger"
                            size="xs"
                            onClick={() => {
                              onDeleteProject(p.id);
                              setPendingDelete(null);
                            }}
                            className="rounded px-1.5 py-0.5"
                          >
                            删除
                          </Button>
                          <Button
                            variant="secondary"
                            size="xs"
                            onClick={() => setPendingDelete(null)}
                            className="rounded px-1.5 py-0.5"
                          >
                            取消
                          </Button>
                        </div>
                      ) : editingId === p.id ? (
                        <input
                          autoFocus
                          value={draftTitle}
                          onChange={textHandler(setDraftTitle)}
                          {...enterCommit({
                            onCommit: () => commitRename(p.id),
                            onCancel: () => setEditingId(null),
                          })}
                          onBlur={() => commitRename(p.id)}
                          className="border-border-strong bg-canvas-deep text-ink w-full rounded border px-2 py-1 text-[13px] outline-none focus:border-violet-400/60"
                        />
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            onClick={() => {
                              onSwitchProject(p.id);
                              setOpen(false);
                            }}
                            className="flex h-auto min-w-0 flex-1 items-center gap-2 text-left font-normal"
                            title={active ? "当前项目" : "切换到此项目"}
                          >
                            <span
                              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                active ? "bg-primary" : "bg-border-strong"
                              }`}
                            />
                            <span
                              className={`truncate text-[13px] ${
                                active
                                  ? "text-ink font-medium"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {shown}
                            </span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => {
                              setDraftTitle(shown);
                              setEditingId(p.id);
                            }}
                            className="text-muted-foreground hover:text-ink-bright shrink-0 rounded opacity-0 group-hover:opacity-100"
                            title="重命名项目"
                          >
                            ✎
                          </Button>
                          {projects.length > 1 && (
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => setPendingDelete(p.id)}
                              className="text-ink-muted hover:text-danger-strong shrink-0 rounded opacity-0 group-hover:opacity-100"
                              title="删除项目"
                            >
                              🗑
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="border-border border-t p-1">
                {creating ? (
                  <input
                    autoFocus
                    value={draftTitle}
                    onChange={textHandler(setDraftTitle)}
                    {...enterCommit({
                      onCommit: commitCreate,
                      onCancel: () => {
                        setCreating(false);
                        setDraftTitle("");
                      },
                    })}
                    placeholder="新项目名称（回车确认）"
                    className="border-border-strong bg-canvas-deep text-ink placeholder:text-ink-fainter w-full rounded border px-2 py-1 text-[13px] outline-none focus:border-violet-400/60"
                  />
                ) : (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setDraftTitle("");
                      setCreating(true);
                      setEditingId(null);
                    }}
                    className="text-muted-foreground hover:text-ink hover:bg-surface-2 h-auto w-full rounded-lg px-2 py-1.5 text-left font-normal"
                  >
                    ＋ 新建项目
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 项目总进度：放到最顶部（设计稿红框区域） */}
      <ProgressBar
        value={progressPct}
        label="项目总进度"
        className="hidden w-full max-w-[260px] text-[11px] lg:block"
        trackClassName="bg-elevated mt-1.5 h-2"
      />

      <div className="flex flex-1 items-center justify-end gap-3">
        <span className="bg-amber/15 text-amber rounded-full px-3 py-1.5 text-xs font-medium">
          距离成片还差 {pendingCategories} 个阶段
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={onOpenApiSettings}
          className="text-muted-foreground hover:text-ink bg-subtle hover:bg-surface-2 gap-1 rounded-full px-3 py-1.5 text-xs"
          title="为远端模型配置工坊各模式下的输入 / 输出"
        >
          <Icon name="settings" size={13} />
          模型适配
          {anyChannelConfigured ? " · 已配置" : ""}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={onOpenModeContract}
          className="text-muted-foreground hover:text-ink bg-subtle hover:bg-surface-2 gap-1 rounded-full px-3 py-1.5 text-xs"
          title="配置每种模式对外有哪些统一输入 / 输出（本地工作流按它配落点）"
        >
          <Icon name="settings" size={13} />
          模式契约
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="账户"
          className="bg-primary/50 rounded-full text-white"
        >
          <Icon name="user" size={16} />
        </Button>
      </div>
    </header>
  );
}
