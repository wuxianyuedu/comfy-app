"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Trash, X } from "lucide-react";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import {
  fetchVideoTasks,
  submitGeneration,
  type VideoTask,
} from "~/lib/media/video-queue-client";
import { overlayClass } from "~/lib/full-screen-layer";

/* ── 视频队列弹窗 —— 接了真实的 VIDEO 任务 ──
  从 /api/tasks 拉取用户的 VIDEO 类型任务（已筛选），显示实时
  状态（QUEUED / RUNNING / SUCCEEDED / FAILED），每 4s 自动刷新，
  让用户批量提交新片段，并打开某个片段的结果 / 结果详情。
*/

const STATUS_META: Record<
  string,
  { icon: string; label: string; cls: string }
> = {
  QUEUED: { icon: "hourglass", label: "排队中", cls: "text-ink-muted" },
  RUNNING: {
    icon: "zap",
    label: "生成中",
    cls: "text-amber-600 dark:text-amber-400",
  },
  SUCCEEDED: {
    icon: "check",
    label: "已完成",
    cls: "text-emerald-600 dark:text-emerald-400",
  },
  FAILED: { icon: "x", label: "失败", cls: "text-red-600 dark:text-red-400" },
  CANCELLED: { icon: "ban", label: "已取消", cls: "text-ink-fainter" },
};

export interface VideoQueueModalProps {
  open: boolean;
  onClose: () => void;
  /** 弹窗打开时要提交的可选提示词批次。 */
  draftItems?: { prompt: string; params?: Record<string, unknown> }[];
  /** 点某个片段时调用 —— 让父级打开它的详情视图。 */
  onOpenTask?: (taskId: string) => void;
}

export function VideoQueueModal({
  open,
  onClose,
  draftItems = [],
  onOpenTask,
}: VideoQueueModalProps) {
  const [tasks, setTasks] = useState<VideoTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<
    { prompt: string; params?: Record<string, unknown> }[]
  >([]);
  const [tab, setTab] = useState<"queue" | "draft">("queue");
  const submittedRef = useRef(false);

  const loadTasks = useCallback(async () => {
    if (!open) return;
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

  // 打开时初始加载 + 每 4s 轮询（VIDEO 任务耗时较长）。
  useEffect(() => {
    if (!open) return;
    submittedRef.current = false;
    const t = setInterval(() => void loadTasks(), 4000);
    // 把首次拉取延出 effect 体（React 19 规则：
    // effect 内不得同步 setState）。
    const first = setTimeout(() => void loadTasks(), 0);
    return () => {
      clearInterval(t);
      clearTimeout(first);
    };
  }, [open, loadTasks]);

  // 草稿项到达时，给草稿编辑器播种并切到草稿页签
  //（渲染期间调整，React 19 模式）。
  const [prevSeedOpen, setPrevSeedOpen] = useState(open);
  const [prevSeedDraftItems, setPrevSeedDraftItems] = useState(draftItems);
  if (
    (open !== prevSeedOpen || draftItems !== prevSeedDraftItems) &&
    open &&
    draftItems.length
  ) {
    setPrevSeedOpen(open);
    setPrevSeedDraftItems(draftItems);
    setDraft(draftItems);
    setTab("draft");
  }

  const submitDrafts = useCallback(async () => {
    const items = draft.filter((draft) => draft.prompt.trim());
    if (!items.length) return;
    setSubmitting(true);
    setError("");
    try {
      let ok = 0;
      for (const it of items) {
        try {
          const d = await submitGeneration(it.params, it.prompt);
          if (d.taskId) ok++;
        } catch {
          /* 跳过失败项 */
        }
      }
      if (ok > 0) {
        setDraft([]);
        setTab("queue");
        void loadTasks();
      } else {
        setError("提交失败，请检查参数或 ComfyUI 连接");
      }
    } catch {
      setError("提交失败");
    } finally {
      setSubmitting(false);
    }
  }, [draft, loadTasks]);

  if (!open) return null;

  const runningCount = tasks.filter(
    (task) => task.status === "RUNNING" || task.status === "QUEUED",
  ).length;

  return (
    <div
      className={overlayClass(
        "modal",
        "z-9998 flex items-center justify-center bg-black/25 p-4 backdrop-blur-sm dark:bg-black/60",
      )}
    >
      <div className="bg-node border-border-strong flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border shadow-2xl shadow-black/20 dark:shadow-black/50">
        {/* Header */}
        <div className="border-border-strong flex items-center justify-between border-b px-5 py-3.5">
          <div className="flex items-center gap-3">
            <h3 className="u-title">视频生成队列</h3>
            {runningCount > 0 && (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-400">
                {runningCount} 个进行中
              </span>
            )}
            <Button
              variant="link"
              onClick={loadTasks}
              className="text-ink-muted hover:text-primary h-auto p-0 text-[11px]"
              title="刷新"
            >
              ↻ 刷新
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <div className="bg-subtle flex rounded-lg p-0.5">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setTab("queue")}
                className={`h-auto rounded-md px-3 py-1.5 ${
                  tab === "queue"
                    ? "bg-surface-2 text-ink-bright hover:bg-surface-2"
                    : "text-ink-muted hover:text-ink-soft"
                }`}
              >
                生成队列
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setTab("draft")}
                className={`h-auto rounded-md px-3 py-1.5 ${
                  tab === "draft"
                    ? "bg-surface-2 text-ink-bright hover:bg-surface-2"
                    : "text-ink-muted hover:text-ink-soft"
                }`}
              >
                批量提交（{draft.length}）
              </Button>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              className="text-ink-muted hover:text-ink-soft"
              aria-label="关闭"
            >
              <X size={16} />
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === "queue" ? (
            <div className="space-y-3">
              {loading && tasks.length === 0 ? (
                <p className="text-ink-fainter py-10 text-center text-xs">
                  加载中…
                </p>
              ) : tasks.length === 0 ? (
                <p className="text-ink-fainter py-10 text-center text-xs">
                  暂无视频生成任务。切到「批量提交」添加分镜，或在创作台「视频」模式直接生成。
                </p>
              ) : (
                tasks.map((task, index) => {
                  const meta = STATUS_META[task.status] ?? STATUS_META.QUEUED;
                  return (
                    <div
                      key={task.id}
                      className="border-border-strong bg-subtle flex items-center gap-3 rounded-xl border p-3"
                    >
                      <div className="bg-canvas-deep flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg">
                        {task.video ? (
                          <MediaThumbnail
                            src={task.video}
                            alt={`V${String(index + 1).padStart(2, "0")}`}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <Icon
                            name="film"
                            size={18}
                            className="text-ink-muted"
                          />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="mb-0.5 flex items-center gap-2">
                          <span className="font-mono text-xs text-violet-700 dark:text-violet-300">
                            V{String(index + 1).padStart(2, "0")}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 text-xs ${meta!.cls}`}
                          >
                            <Icon name={meta!.icon} size={13} />
                            {meta!.label}
                          </span>
                        </div>
                        <p
                          className="text-ink-soft truncate text-xs"
                          title={task.prompt}
                        >
                          {task.prompt || "（无提示词）"}
                        </p>
                        <p className="text-ink-fainter mt-0.5 truncate font-mono text-[10px]">
                          {task.workflowName}
                        </p>
                        {task.status === "FAILED" && task.error && (
                          <p
                            className="mt-0.5 truncate text-[10px] text-red-700 dark:text-red-400"
                            title={task.error}
                          >
                            {task.error}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => onOpenTask?.(task.id)}
                          className="border-border-strong text-ink-soft hover:bg-subtle h-auto rounded-md px-2.5 py-1"
                        >
                          详情
                        </Button>
                        {task.video && (
                          <a
                            href={task.video}
                            download
                            className="rounded-md bg-violet-500/20 px-2.5 py-1 text-[11px] text-violet-700 transition-colors hover:bg-violet-500/30 dark:text-violet-300"
                          >
                            下载
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              {error && (
                <p className="text-center text-xs text-red-700 dark:text-red-400">
                  {error}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {draft.length === 0 ? (
                <p className="text-ink-fainter py-8 text-center text-xs">
                  暂无待提交分镜。在下方逐个添加提示词（每行一个），或粘贴工坊分镜批量导入。
                </p>
              ) : (
                draft.map((draftItem, index) => (
                  <div
                    key={`draft-${index}`}
                    className="border-border-strong bg-subtle flex items-start gap-2 rounded-xl border p-3"
                  >
                    <span className="mt-1 font-mono text-xs text-violet-700 dark:text-violet-300">
                      V{String(index + 1).padStart(2, "0")}
                    </span>
                    <Textarea
                      value={draftItem.prompt}
                      onChange={(event) =>
                        setDraft((arr) =>
                          arr.map((item, idx) =>
                            idx === index
                              ? { ...item, prompt: event.target.value }
                              : item,
                          ),
                        )
                      }
                      rows={2}
                      placeholder="分镜提示词，含镜头运动描述…"
                      className="border-border-strong bg-subtle text-ink-bright placeholder:text-ink-fainter min-w-0 flex-1 resize-none text-xs"
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() =>
                        setDraft((arr) => arr.filter((_, j) => j !== index))
                      }
                      className="text-ink-muted hover:text-danger-strong mt-1"
                      aria-label="删除"
                    >
                      <Trash size={14} />
                    </Button>
                  </div>
                ))
              )}

              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => setDraft((arr) => [...arr, { prompt: "" }])}
                  className="border-border-strong text-ink-soft hover:border-primary/30 hover:text-primary h-auto rounded-lg border-dashed px-3 py-1.5"
                >
                  ＋ 添加一行
                </Button>
                <input
                  type="file"
                  accept=".txt,.csv"
                  className="hidden"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    const text = await file.text();
                    const lines = text
                      .split(/\r?\n/)
                      .map((segment) => segment.trim())
                      .filter(Boolean);
                    setDraft((arr) => [
                      ...arr,
                      ...lines.map((prompt) => ({ prompt })),
                    ]);
                  }}
                  id="vq-import"
                />
                <label
                  htmlFor="vq-import"
                  className="border-border-strong text-ink-soft hover:bg-subtle cursor-pointer rounded-lg border px-3 py-1.5 text-xs transition-colors"
                >
                  导入 txt/csv
                </label>
              </div>

              {error && (
                <p className="text-center text-xs text-red-700 dark:text-red-400">
                  {error}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {tab === "draft" && (
          <div className="border-border-strong flex items-center justify-between border-t px-5 py-3.5">
            <span className="text-ink-muted text-[11px]">
              提交后将进入「生成队列」并实时刷新
            </span>
            <Button
              variant="primary-solid"
              onClick={submitDrafts}
              disabled={
                submitting ||
                draft.filter((draft) => draft.prompt.trim()).length === 0
              }
              className="h-auto rounded-lg px-5 py-2"
            >
              {submitting
                ? "提交中…"
                : `开始生成（${draft.filter((draft) => draft.prompt.trim()).length}）`}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
