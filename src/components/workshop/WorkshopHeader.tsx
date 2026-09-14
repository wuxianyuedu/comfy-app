"use client";

// 工坊顶栏：项目切换器、项目标识、总进度、API 通道入口。纯展示，数据由 controller 下发。

import { useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Icon } from "~/components/ui/icon";
import type { ApiChannelsView } from "~/lib/workshop/api-channel-shared";
import type { WorkshopProjectSummary } from "./hooks/use-workshop-pipeline";

interface WorkshopHeaderProps {
  title: string;
  progressPct: number;
  pendingCategories: number;
  apiChannels: ApiChannelsView | null;
  onOpenApiSettings: () => void;
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setEditingId(null);
        setCreating(false);
        setPendingDelete(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

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
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-ink hover:bg-primary/10 flex max-w-[240px] items-center gap-2 rounded-lg border border-(--color-border) bg-(--color-subtle) px-3 py-1.5 transition-colors"
            title="切换 / 新建 / 重命名项目"
          >
            <span className="truncate text-[13px] font-medium">{title}</span>
            <span className="text-muted-foreground shrink-0 text-[10px]">
              {projects.length} 个项目
            </span>
            <span className="text-muted-foreground shrink-0 text-[10px]">
              {open ? "▲" : "▼"}
            </span>
          </button>

          {open && (
            <div className="absolute left-0 top-full z-50 mt-1.5 w-[280px] overflow-hidden rounded-xl border border-(--color-border) bg-(--color-panel)/98 shadow-2xl backdrop-blur-md">
              <div className="max-h-[280px] overflow-y-auto py-1">
                {projects.map((p) => {
                  const active = p.id === activeProjectId;
                  const shown = active ? title : p.title;
                  return (
                    <div
                      key={p.id}
                      className="group flex items-center gap-1 px-2 py-1.5 hover:bg-(--color-surface-2)"
                    >
                      {pendingDelete === p.id ? (
                        <div className="flex w-full items-center gap-2">
                          <span className="text-muted-foreground flex-1 truncate text-[12px]">
                            删除「{shown}」？
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              onDeleteProject(p.id);
                              setPendingDelete(null);
                            }}
                            className="rounded bg-red-500/20 px-1.5 py-0.5 text-[11px] text-red-700 hover:bg-red-500/30 dark:text-red-400"
                          >
                            删除
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingDelete(null)}
                            className="rounded bg-(--color-surface-2) px-1.5 py-0.5 text-[11px] text-(--color-ink-strong) hover:bg-(--color-subtle)"
                          >
                            取消
                          </button>
                        </div>
                      ) : editingId === p.id ? (
                        <input
                          autoFocus
                          value={draftTitle}
                          onChange={(e) => setDraftTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename(p.id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          onBlur={() => commitRename(p.id)}
                          className="border-border-strong bg-canvas-deep text-ink w-full rounded border px-2 py-1 text-[13px] outline-none focus:border-violet-400/60"
                        />
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              onSwitchProject(p.id);
                              setOpen(false);
                            }}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            title={active ? "当前项目" : "切换到此项目"}
                          >
                            <span
                              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                active ? "bg-primary" : "bg-(--color-border-strong)"
                              }`}
                            />
                            <span
                              className={`truncate text-[13px] ${
                                active ? "text-ink font-medium" : "text-muted-foreground"
                              }`}
                            >
                              {shown}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDraftTitle(shown);
                              setEditingId(p.id);
                            }}
                            className="text-muted-foreground shrink-0 rounded px-1 text-[11px] opacity-0 transition-opacity hover:text-(--color-ink-bright) group-hover:opacity-100"
                            title="重命名项目"
                          >
                            ✎
                          </button>
                          {projects.length > 1 && (
                            <button
                              type="button"
                              onClick={() => setPendingDelete(p.id)}
                              className="text-ink-muted shrink-0 rounded px-1 text-[11px] opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-600 dark:hover:text-red-400"
                              title="删除项目"
                            >
                              🗑
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-(--color-border) p-1">
                {creating ? (
                  <input
                    autoFocus
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitCreate();
                      if (e.key === "Escape") {
                        setCreating(false);
                        setDraftTitle("");
                      }
                    }}
                    placeholder="新项目名称（回车确认）"
                    className="border-border-strong bg-canvas-deep text-ink placeholder:text-ink-fainter w-full rounded border px-2 py-1 text-[13px] outline-none focus:border-violet-400/60"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setDraftTitle("");
                      setCreating(true);
                      setEditingId(null);
                    }}
                    className="text-muted-foreground hover:text-ink w-full rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-(--color-surface-2)"
                  >
                    ＋ 新建项目
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 项目总进度：放到最顶部（设计稿红框区域） */}
      <div className="hidden w-full max-w-[260px] lg:block">
        <div className="text-muted-foreground flex items-center justify-between text-[11px]">
          <span>项目总进度</span>
          <span className="text-primary font-medium">{progressPct}%</span>
        </div>
        <div className="bg-elevated mt-1.5 h-2 w-full rounded-full">
          <div
            className="bg-primary h-2 rounded-full transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <div className="flex flex-1 items-center justify-end gap-3">
        <span className="rounded-full bg-(--color-amber)/15 px-3 py-1.5 text-xs font-medium text-(--color-amber)">
          距离成片还差 {pendingCategories} 个阶段
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={onOpenApiSettings}
          className="text-muted-foreground hover:text-ink gap-1 rounded-full bg-(--color-subtle) px-3 py-1.5 text-xs hover:bg-(--color-surface-2)"
          title="为远端模型配置工坊各模式下的输入 / 输出"
        >
          <Icon name="settings" size={13} />
          模型适配
          {anyChannelConfigured ? " · 已配置" : ""}
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
