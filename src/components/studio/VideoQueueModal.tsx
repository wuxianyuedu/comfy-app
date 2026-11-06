"use client";

import { useState, useCallback } from "react";
import { X } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Hint } from "~/components/ui/hint";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { useInterval } from "~/components/ui/use-interval";
import { fetchVideoTasks, type VideoTask } from "~/lib/media/video-queue-client";
import { Dialog, DialogContent } from "~/components/ui/dialog";
import { OVERLAY_MAX_HEIGHT } from "~/components/ui/overlay-max-height";

/* ── 视频队列弹窗 —— 接了真实的 VIDEO 任务 ──
 从 /api/tasks 拉取用户的 VIDEO 类型任务（已筛选），显示实时状态（QUEUED / RUNNING / SUCCEEDED / FAILED），
 每 4s 自动刷新，并可打开某个片段的结果 / 详情。本弹窗只读地看队列：「批量提交」草稿页签整格撤掉（ISSUE #2169）——
 每条草稿只有提示词、没有必填的 workflow，那条通路**从来没成功过**；新视频唯一真实入口是创作台「视频」模式。 */

type StatusMeta = { cls: string; icon: string; label: string };

const STATUS_META: Record<"QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED", StatusMeta> =
  {
    QUEUED: { icon: "hourglass", label: "排队中", cls: "text-ink-muted" },
    RUNNING: {
      icon: "zap",
      label: "生成中",
      cls: "text-warning-strong",
    },
    SUCCEEDED: {
      icon: "check",
      label: "已完成",
      cls: "text-success-strong",
    },
    FAILED: { icon: "x", label: "失败", cls: "text-destructive" },
    CANCELLED: { icon: "ban", label: "已取消", cls: "text-ink-fainter" },
  };

/** 后端给的 `task.status` 是宽字符串：只有落在 `STATUS_META` 的键上才认。 */
function isTaskStatus(status: string): status is keyof typeof STATUS_META {
  return Object.hasOwn(STATUS_META, status);
}

/** 按任务状态取展示元数据。`task.status` 是宽字符串（来自后端），这里收口
 *  「未知状态 → 排队中」这一条兜底判据，返回**非空**，调用点不再各自 `!`。 */
function statusMetaFor(status: string): StatusMeta {
  return isTaskStatus(status) ? STATUS_META[status] : STATUS_META.QUEUED;
}

export type VideoQueueModalProps = {
  onClose: () => void;
  /** 点某个片段时调用 —— 让父级打开它的详情视图。 */
  onOpenTask?: (taskId: string) => void;
  open: boolean;
};

export function VideoQueueModal({ open, onClose, onOpenTask }: VideoQueueModalProps) {
  const [tasks, setTasks] = useState<Array<VideoTask>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadTasks = useCallback(async () => {
    if (!open) {
      return;
    }
    setLoading(true);
    try {
      const videos = await fetchVideoTasks();
      setTasks(videos);
    } catch {
      setError("加载队列失败");
    } finally {
      setLoading(false);
    }
  }, [open]);

  // 打开时初始加载 + 每 4s 轮询（VIDEO 任务耗时较长）。挂载即先拉一次由
  //`useInterval` 的`immediate` 给（规范 16 §16.2.4.15）—— 此前自己要
  //`setTimeout(…, 0)` 把首次拉取延出 effect 体，现在那一层由 hook 承担。
  useInterval(loadTasks, { ms: open ? 4000 : null });

  if (!open) {
    return null;
  }

  const runningCount = tasks.filter(
    (task) => task.status === "RUNNING" || task.status === "QUEUED",
  ).length;

  /* 关闭语义交给`ui/dialog`：此前这里**既没有点遮罩关闭、也没有 Esc** ——
 只能用右上角的 ✕ 关掉，键盘用户尤其难退出。 */
  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      open
    >
      <DialogContent
        aria-label="视频生成队列"
        className="bg-transparent p-0 ring-0"
        popupClassName="max-w-3xl"
        showCloseButton={false}
      >
        <div
          className={`bg-node border-border-strong flex ${OVERLAY_MAX_HEIGHT} w-full max-w-3xl flex-col overflow-hidden rounded-2xl border shadow-2xl shadow-black/20 dark:shadow-black/50`}
        >
          {/* Header */}
          <div className="border-border-strong flex items-center justify-between border-b px-5 py-3.5">
            <div className="flex items-center gap-3">
              <h3 className="u-title">视频生成队列</h3>
              {runningCount > 0 && (
                <Badge size="pill-md" tone="warning">
                  {runningCount} 个进行中
                </Badge>
              )}
              <Hint label="刷新">
                <Button
                  className="text-ink-muted hover:text-primary text-2xs h-auto p-0"
                  onClick={loadTasks}
                  variant="link"
                >
                  ↻ 刷新
                </Button>
              </Hint>
            </div>
            <div className="flex items-center gap-2">
              <Button
                aria-label="关闭"
                className="text-ink-muted hover:text-ink-soft"
                onClick={onClose}
                size="icon-sm"
                variant="ghost"
              >
                <X data-icon="inline-start" size={16} />
              </Button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5">
            <div className="flex-col gap-3">
              {loading && tasks.length === 0 ? (
                <p className="text-ink-fainter py-10 text-center text-xs">加载中…</p>
              ) : tasks.length === 0 ? (
                <p className="text-ink-fainter py-10 text-center text-xs">
                  暂无视频生成任务。在创作台「视频」模式直接生成（新视频的入口在创作台，这里只看队列）。
                </p>
              ) : (
                tasks.map((task, index) => {
                  const meta = statusMetaFor(task.status);
                  return (
                    <div
                      className="border-border-strong bg-subtle flex items-center gap-3 rounded-xl border p-3"
                      key={task.id}
                    >
                      <div className="bg-canvas-deep flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg">
                        {task.video !== null && task.video !== "" ? (
                          <MediaThumbnail
                            alt={`V${String(index + 1).padStart(2, "0")}`}
                            className="h-full w-full object-cover"
                            src={task.video}
                          />
                        ) : (
                          <Icon className="text-ink-muted" name="film" size={18} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="mb-0.5 flex items-center gap-2">
                          <span className="text-primary-strong font-mono text-xs">
                            V{String(index + 1).padStart(2, "0")}
                          </span>
                          <span className={`inline-flex items-center gap-1 text-xs ${meta.cls}`}>
                            <Icon name={meta.icon} size={13} />
                            {meta.label}
                          </span>
                        </div>
                        <p className="text-ink-soft truncate text-xs" title={task.prompt}>
                          {task.prompt || "（无提示词）"}
                        </p>
                        <p className="text-ink-fainter text-3xs mt-0.5 truncate font-mono">
                          {task.workflowName}
                        </p>
                        {task.status === "FAILED" && task.error !== null && task.error !== "" && (
                          <p
                            className="text-destructive text-3xs mt-0.5 truncate"
                            title={task.error}
                          >
                            {task.error}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Button
                          className="border-border-strong text-ink-soft hover:bg-subtle h-auto rounded-md px-2.5 py-1"
                          onClick={() => onOpenTask?.(task.id)}
                          size="xs"
                          variant="outline"
                        >
                          详情
                        </Button>
                        {task.video !== null && task.video !== "" && (
                          <a
                            className="bg-primary/20 text-primary-strong hover:bg-primary/30 text-2xs rounded-md px-2.5 py-1 transition-colors"
                            download
                            href={task.video}
                          >
                            下载
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              {error && <p className="text-destructive text-center text-xs">{error}</p>}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
