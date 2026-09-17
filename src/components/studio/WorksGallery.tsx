"use client";

import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { useToast } from "./ToastProvider";
import { AuroraBackground } from "~/components/studio/ui/AuroraBackground";
import {
  listProjects,
  reapAllEmptyDrafts,
  deleteProject,
  type CanvasProject,
} from "~/lib/project-canvas/canvas-store";
import { ModalDialog } from "~/components/studio/ui/ModalDialog";

/**
 * 项目页面（"所有项目"标签）— 仅展示本地画布项目。
 *
 * 历史意义上这里曾同时渲染"画布项目 + 生成作品 grid"两块（WorksGallery
 * 双分区版）。用户要求"项目页面只显示项目，不要显示生成作品"
 * （历史界面始终由 HistoryList 负责展示任务列表，无需在此重复）。
 *
 * 因此本组件现在只做一件事：读 canvas-store 的本地项目并渲染卡片网格，
 * 附带 hover 删除 + 弹窗确认。所有"生成作品 / 任务 / 详情弹窗"相关 state、
 * fetch /api/tasks、MediaThumb 等都已移除。
 */
export function WorksGallery({
  onOpenTask,
  onOpenCanvasProject,
}: {
  /** 「新建创作」按钮触发 —— 项目页保留它作为跳到生成器的入口。 */
  onOpenTask?: (id: string) => void;
  /** Open a canvas project (set active + jump to canvas view). */
  onOpenCanvasProject?: (id: string) => void;
}) {
  const toast = useToast();

  /** Canvas projects sourced from localStorage (canvas-store). They never
   * land in the /api/tasks table, so we read them separately and refresh on
   * the `comfyapp:canvas-store-changed` event so editing inside the canvas
   * view is reflected here live. */
  const [canvasProjects, setCanvasProjects] = useState<CanvasProject[]>(() => {
    reapAllEmptyDrafts();
    return listProjects();
  });

  /** Canvas-project delete confirmation. Non-null id = the ModalDialog is
   *  open for that project. Resolved projects' names are resolved BEFORE
   *  clearing the dialog so the toast reads the original name even though
   *  the underlying array changes one tick later. */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState(false);

  const handleConfirmDeleteCanvas = useCallback(() => {
    if (!confirmDeleteId) return;
    const id = confirmDeleteId;
    const target = canvasProjects.find(
      (canvasProject) => canvasProject.id === id,
    );
    setPendingDelete(true);
    // Use a microtask delay so the dialog's spinner / disabled state is
    // visible at least one paint frame. deleteProject itself fires
    // `comfyapp:canvas-store-changed` which the mounted listener picks
    // up to refresh `canvasProjects`.
    queueMicrotask(() => {
      deleteProject(id); // canvas-store also clears active-id when matched
      setPendingDelete(false);
      setConfirmDeleteId(null);
      toast.success(`已删除项目「${target?.name ?? "未命名"}」`);
    });
  }, [confirmDeleteId, canvasProjects, toast]);

  const refreshCanvasProjects = useCallback(() => {
    setCanvasProjects(listProjects());
  }, []);

  useEffect(() => {
    // Sweep legacy empty default-named drafts before listing.
    window.addEventListener(
      "comfyapp:canvas-store-changed",
      refreshCanvasProjects,
    );
    return () =>
      window.removeEventListener(
        "comfyapp:canvas-store-changed",
        refreshCanvasProjects,
      );
  }, [refreshCanvasProjects]);

  return (
    <div className="h-full overflow-y-auto">
      <AuroraBackground />
      <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-8 sm:py-10">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-title text-ink text-xl font-bold">所有项目</h1>
            <p className="text-ink-muted mt-1 text-sm">
              本地画布项目，按时间倒序排列。生成作品请查看「历史记录」。
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={refreshCanvasProjects}
              className="border-border text-ink-faint hover:text-ink-bright rounded-lg border px-3 py-2 text-xs"
            >
              ↻ 刷新
            </button>
            <button
              type="button"
              onClick={() => onOpenTask?.("new")}
              className="rounded-lg bg-violet-500/90 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-500"
            >
              新建创作
            </button>
          </div>
        </div>

        {/* ── Canvas Projects Section ── */}
        {canvasProjects.length > 0 ? (
          <section className="mb-10">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="text-ink-strong text-sm font-semibold">
                画布项目{" "}
                <span className="text-ink-fainter ml-1 text-xs font-normal">
                  ({canvasProjects.length})
                </span>
              </h2>
              <span className="text-ink-fainter text-[11px]">
                本地 · 可继续编辑
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {canvasProjects.map((canvasProject) => {
                const nodeCount = canvasProject.nodes?.length ?? 0;
                const edgeCount = canvasProject.edges?.length ?? 0;
                return (
                  <div
                    key={canvasProject.id}
                    className="group border-border-subtle bg-card relative rounded-2xl border transition-all hover:border-cyan-400/25 hover:bg-cyan-400/4"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenCanvasProject?.(canvasProject.id)}
                      className="canvasProject-3.5 flex w-full items-start gap-3 rounded-2xl text-left"
                    >
                      <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-400/12 text-cyan-700 dark:text-cyan-400">
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect x="3" y="3" width="18" height="18" rx="2" />
                          <path d="M3 9h18M9 21V9" />
                          <circle cx="15" cy="15" r="2" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-ink-bright group-hover:text-ink truncate text-sm font-medium">
                          {canvasProject.name || "未命名项目"}
                        </p>
                        <p className="text-ink-muted mt-1 truncate text-[11px]">
                          {nodeCount > 0
                            ? `${nodeCount} 节点 · ${edgeCount} 连线`
                            : "空画布"}
                        </p>
                        <p className="text-ink-fainter mt-0.5 text-[11px]">
                          {projectTimeAgo(canvasProject.updatedAt)}
                        </p>
                      </div>
                    </button>
                    {/* Per-card delete: hover-only, top-right corner.
                       Stops propagation so the parent card-open button
                       doesn't fire. */}
                    <button
                      type="button"
                      aria-label={`删除项目「${canvasProject.name || "未命名"}」`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setConfirmDeleteId(canvasProject.id);
                      }}
                      className="text-ink-muted absolute top-2 right-2 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-500/15 hover:text-red-700 focus-visible:opacity-100 dark:text-red-300"
                    >
                      <Trash2 size={12} />
                      <span>删除</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ) : (
          <section>
            <div className="border-border grid min-h-[360px] place-items-center rounded-2xl border border-dashed">
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-400/12 text-cyan-700 dark:text-cyan-400">
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M3 9h18M9 21V9" />
                    <circle cx="15" cy="15" r="2" />
                  </svg>
                </div>
                <p className="text-ink-strong text-lg font-medium">
                  还没有画布项目
                </p>
                <p className="text-ink-muted mt-1 text-sm">
                  点击右上角「新建创作」开始你的第一个工作流，或者在工作流库载入模板。
                </p>
              </div>
            </div>
          </section>
        )}
      </div>

      {/* ── Canvas-project delete confirm ── */}
      <ModalDialog
        open={confirmDeleteId !== null}
        onClose={() => {
          if (!pendingDelete) setConfirmDeleteId(null);
        }}
        danger
        title="删除此画布项目？"
        description={
          confirmDeleteId
            ? `即将永久删除「${
                canvasProjects.find(
                  (canvasProject) => canvasProject.id === confirmDeleteId,
                )?.name ?? "未命名项目"
              }」。\n该操作不可撤销，画布内的节点与连线将一并丢失。`
            : ""
        }
        confirmLabel="删除项目"
        cancelLabel="取消"
        pending={pendingDelete}
        onConfirm={handleConfirmDeleteCanvas}
      />
    </div>
  );
}

function projectTimeAgo(updatedAt: number) {
  const diff = Date.now() - updatedAt;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚修改";
  if (m < 60) return `${m} 分钟前修改`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前修改`;
  return `${Math.floor(h / 24)} 天前修改`;
}
