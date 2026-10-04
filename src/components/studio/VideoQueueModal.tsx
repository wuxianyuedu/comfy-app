"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { textHandler } from "~/lib/form-props";
import { Trash, X } from "lucide-react";
import { Hint } from "~/components/ui/hint";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { runAsyncAction } from "~/lib/async-action";
import { readFileAsText } from "~/lib/file-io";
import { useFilePicker } from "~/components/ui/file-picker";
import { useToast } from "~/components/studio/ToastProvider";
import { useBusyAction } from "~/components/ui/use-busy-action";
import { useInterval } from "~/components/ui/use-interval";
import { Textarea } from "~/components/ui/textarea";
import {
  fetchVideoTasks,
  submitGeneration,
  type VideoTask,
} from "~/lib/media/video-queue-client";
import { Dialog, DialogContent } from "~/components/ui/dialog";

/* ── 视频队列弹窗 —— 接了真实的 VIDEO 任务 ──
 从 /api/tasks 拉取用户的 VIDEO 类型任务（已筛选），显示实时
 状态（QUEUED / RUNNING / SUCCEEDED / FAILED），每 4s 自动刷新，
 让用户批量提交新片段，并打开某个片段的结果 / 结果详情。
*/

type StatusMeta = { icon: string; label: string; cls: string };

const STATUS_META: Record<
  "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED",
  StatusMeta
> = {
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

/** 按任务状态取展示元数据。`task.status` 是宽字符串（来自后端），这里收口
 *  「未知状态 → 排队中」这一条兜底判据，返回**非空**，调用点不再各自 `!`。 */
function statusMetaFor(status: string): StatusMeta {
  return status in STATUS_META
    ? STATUS_META[status as keyof typeof STATUS_META]
    : STATUS_META.QUEUED;
}

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
  /* 忙碌位走唯一出口（规范 16 §16.2.4.71）：此前复位写在动作之后。 */
  const submitBusy = useBusyAction();
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

  // 打开时初始加载 + 每 4s 轮询（VIDEO 任务耗时较长）。挂载即先拉一次由
  //`useInterval` 的`immediate` 给（规范 16 §16.2.4.15）—— 此前自己要
  //`setTimeout(…, 0)` 把首次拉取延出 effect 体，现在那一层由 hook 承担。
  useEffect(() => {
    if (!open) return;
    submittedRef.current = false;
  }, [open]);
  useInterval(loadTasks, { ms: open ? 4000 : null });

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
    setError("");
    /* 「逐条提交、跳过失败项、只要有一条成功就算成功」是本动作的域语义，
     * 留在调用处；**失败通道只有一条**（这块行内`setError`），
     * 所以`report` 恒接到它上（规范 16 §16.2.4.30：通道由调用处给）。 */
    const result = await submitBusy.run(() =>
      runAsyncAction(
        async () => {
          let ok = 0;
          for (const it of items) {
            try {
              const d = await submitGeneration(it.params, it.prompt);
              if (d.taskId) ok++;
            } catch {
              /* 跳过失败项 */
            }
          }
          if (ok === 0) {
            /* 一条都没成：抛出去走出口的失败通道，文案带可执行动作。 */
            throw new Error("提交失败，请检查参数或 ComfyUI 连接");
          }
          setDraft([]);
          setTab("queue");
          void loadTasks();
        },
        {
          report: (kind: "ok" | "err", detail: string) => {
            if (kind === "err") setError(detail);
          },
          failureText: "提交失败",
        },
      ),
    );
    return result;
  }, [draft, loadTasks, submitBusy]);

  if (!open) return null;

  const runningCount = tasks.filter(
    (task) => task.status === "RUNNING" || task.status === "QUEUED",
  ).length;

  /* 关闭语义交给`ui/dialog`：此前这里**既没有点遮罩关闭、也没有 Esc** ——
 只能用右上角的 ✕ 关掉，键盘用户尤其难退出。 */
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        aria-label="视频生成队列"
        showCloseButton={false}
        className="bg-transparent p-0 ring-0"
        popupClassName="max-w-3xl"
      >
        <div className="bg-node border-border-strong flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border shadow-2xl shadow-black/20 dark:shadow-black/50">
          {/* Header */}
          <div className="border-border-strong flex items-center justify-between border-b px-5 py-3.5">
            <div className="flex items-center gap-3">
              <h3 className="u-title">视频生成队列</h3>
              {runningCount > 0 && (
                <span className="bg-warning/15 text-warning-strong text-2xs rounded-full px-2 py-0.5">
                  {runningCount} 个进行中
                </span>
              )}
              <Hint label="刷新">
                <Button
                  variant="link"
                  onClick={loadTasks}
                  className="text-ink-muted hover:text-primary text-2xs h-auto p-0"
                >
                  ↻ 刷新
                </Button>
              </Hint>
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
                <X data-icon="inline-start" size={16} />
              </Button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5">
            {tab === "queue" ? (
              <div className="flex-col gap-3">
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
                    const meta = statusMetaFor(task.status);
                    return (
                      <div
                        key={task.id}
                        className="border-border-strong bg-subtle flex items-center gap-3 rounded-xl border p-3"
                      >
                        <div className="bg-canvas-deep flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg">
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
                            <span className="text-primary-strong font-mono text-xs">
                              V{String(index + 1).padStart(2, "0")}
                            </span>
                            <span
                              className={`inline-flex items-center gap-1 text-xs ${meta.cls}`}
                            >
                              <Icon name={meta.icon} size={13} />
                              {meta.label}
                            </span>
                          </div>
                          <p
                            className="text-ink-soft truncate text-xs"
                            title={task.prompt}
                          >
                            {task.prompt || "（无提示词）"}
                          </p>
                          <p className="text-ink-fainter text-3xs mt-0.5 truncate font-mono">
                            {task.workflowName}
                          </p>
                          {task.status === "FAILED" && task.error && (
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
                              className="bg-primary/20 text-primary-strong hover:bg-primary/30 text-2xs rounded-md px-2.5 py-1 transition-colors"
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
                  <p className="text-destructive text-center text-xs">
                    {error}
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
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
                      <span className="text-primary-strong mt-1 font-mono text-xs">
                        V{String(index + 1).padStart(2, "0")}
                      </span>
                      <Textarea
                        value={draftItem.prompt}
                        onChange={textHandler((prompt) =>
                          setDraft((arr) =>
                            arr.map((item, idx) =>
                              idx === index ? { ...item, prompt } : item,
                            ),
                          ),
                        )}
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
                        <Trash data-icon="inline-start" size={14} />
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
                  <ImportLinesButton
                    onImported={(lines) =>
                      setDraft((arr) => [
                        ...arr,
                        ...lines.map((prompt) => ({ prompt })),
                      ])
                    }
                  />
                </div>

                {error && (
                  <p className="text-destructive text-center text-xs">
                    {error}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          {tab === "draft" && (
            <div className="border-border-strong flex items-center justify-between border-t px-5 py-3.5">
              <span className="text-ink-muted text-2xs">
                提交后将进入「生成队列」并实时刷新
              </span>
              <Button
                variant="primary-solid"
                onClick={submitDrafts}
                disabled={
                  submitBusy.busy ||
                  draft.filter((draft) => draft.prompt.trim()).length === 0
                }
                className="h-auto rounded-lg px-5 py-2"
              >
                {submitBusy.busy
                  ? "提交中…"
                  : `开始生成（${draft.filter((draft) => draft.prompt.trim()).length}）`}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 「导入 txt/csv」入口：按钮 + 隐藏 input 二合一。
 * 此前这里用`<input id="vq-import">` +`<label htmlFor="vq-import">` 做
 * 隐式关联 —— 与全库另外 8 个落点（有的用 ref.click()、有的干脆把 input
 * 露在界面上）写法都不同，且成了全仓唯一一处靠`id` 拼接触发的入口。
 * 现在统一走`ui/file-picker`。 */
function ImportLinesButton({
  onImported,
}: {
  onImported: (lines: string[]) => void;
}) {
  const toast = useToast();
  const picker = useFilePicker({
    accept: ".txt,.csv",
    /* 读取统一走`~/lib/file-io`（§16.2.4.27）：`file.text()` 的失败路径
     * 此前在这里被`void ... .then(...)` 整个吞掉 —— 读失败时用户看不到
     * 任何反馈（`.then` 没有 rejection 分支）。 */
    onPick: (file) => {
      void readFileAsText(file)
        .then((text) => {
          const lines = text
            .split(/\r?\n/)
            .map((segment) => segment.trim())
            .filter(Boolean);
          onImported(lines);
        })
        .catch(() => toast.error("读取文件失败"));
    },
  });
  return (
    <>
      <Button
        variant="outline"
        size="xs"
        onClick={picker.open}
        className="border-border-strong text-ink-soft hover:bg-subtle h-auto rounded-lg px-3 py-1.5 text-xs transition-colors"
      >
        导入 txt/csv
      </Button>
      <picker.Input />
    </>
  );
}
