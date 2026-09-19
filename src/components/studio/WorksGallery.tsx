"use client";

import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { useToast } from "./ToastProvider";
import { AuroraBackground } from "~/components/ui/aurora-background";
import {
  listProjects,
  reapAllEmptyDrafts,
  deleteProject,
  type CanvasProject,
} from "~/lib/project-canvas/canvas-store";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Button } from "~/components/ui/button";
import { timeAgo } from "~/lib/time-format";

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
  /** 打开一个画布项目（设为活跃 + 跳到画布视图）。 */
  onOpenCanvasProject?: (id: string) => void;
}) {
  const toast = useToast();

  /** 来自 localStorage（canvas-store）的画布项目。它们从不
   * 落进 /api/tasks 表，所以我们单独读取，并在
   * `comfyapp:canvas-store-changed` 事件上刷新，好让画布
   * 视图内的编辑能实时反映到这里。 */
  const [canvasProjects, setCanvasProjects] = useState<CanvasProject[]>(() => {
    reapAllEmptyDrafts();
    return listProjects();
  });

  /** 画布项目删除确认。id 非 null = 该项目的 ConfirmDialog
   *  已打开。项目名在清空对话框**之前**解析好，好让
   *  toast 读到原名，即使底层数组
   *  下一 tick 就变了。 */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState(false);

  const handleConfirmDeleteCanvas = useCallback(() => {
    if (!confirmDeleteId) return;
    const id = confirmDeleteId;
    const target = canvasProjects.find(
      (canvasProject) => canvasProject.id === id,
    );
    setPendingDelete(true);
    // 用微任务延迟，好让对话框的 spinner / 禁用态
    // 至少可见一帧。deleteProject 本身会触发
    // `comfyapp:canvas-store-changed`，已挂载的监听器接住它
    // 来刷新 `canvasProjects`。
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
    // 列出前先清掉遗留的空默认名草稿。
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
            <Button
              variant="outline"
              onClick={refreshCanvasProjects}
              className="border-border text-ink-faint hover:text-ink-bright h-auto rounded-lg px-3 py-2"
            >
              ↻ 刷新
            </Button>
            <Button
              variant="primary-solid"
              onClick={() => onOpenTask?.("new")}
              className="h-auto rounded-lg px-4 py-2"
            >
              新建创作
            </Button>
          </div>
        </div>

        {/* ── 画布项目区 ── */}
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
                    <Button
                      variant="ghost"
                      onClick={() => onOpenCanvasProject?.(canvasProject.id)}
                      className="canvasProject-3.5 flex h-auto w-full items-start gap-3 rounded-2xl text-left font-normal"
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
                          {timeAgo(canvasProject.updatedAt, {
                            suffix: "修改",
                          }) ?? "刚刚修改"}
                        </p>
                      </div>
                    </Button>
                    {/* 逐卡片删除：仅悬停显示，右上角。
                       阻断冒泡，好让父级卡片打开按钮
                       不触发。 */}
                    <Button
                      variant="ghost"
                      size="xs"

                      aria-label={`删除项目「${canvasProject.name || "未命名"}」`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setConfirmDeleteId(canvasProject.id);
                      }}
                      className="text-ink-muted hover:bg-danger/15 hover:text-danger-strong absolute top-2 right-2 h-auto gap-1 rounded-md px-1.5 py-1 text-[11px] opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <Trash2 size={12} />
                      <span>删除</span>
                    </Button>
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

      {/* ── 画布项目删除确认 ── */}
      <ConfirmDialog
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
