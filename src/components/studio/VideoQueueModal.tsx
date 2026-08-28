/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { MediaThumbnail } from "./MediaThumbnail";
import { isVideo } from "@/lib/media";
import { Icon } from "@/components/ui/Icon";
import { vanillaApi } from "~/trpc/vanilla";

/* ── Video Queue Modal — wired to real VIDEO tasks ──
  Fetches the user's VIDEO-type tasks from /api/tasks (filtered), shows live
  status (QUEUED / RUNNING / SUCCEEDED / FAILED), auto-refreshes every 4s,
  lets the user batch-submit new clips, and open a clip's result/result detail.
*/

interface VideoTask {
  id: string;
  status: string;
  prompt: string;
  workflowName: string;
  video?: string | null; // local path of the produced video (if any)
  error?: string | null;
}

const STATUS_META: Record<string, { icon: string; label: string; cls: string }> = {
  QUEUED: { icon: "hourglass", label: "排队中", cls: "text-gray-500" },
  RUNNING: { icon: "zap", label: "生成中", cls: "text-amber-400" },
  SUCCEEDED: { icon: "check", label: "已完成", cls: "text-emerald-400" },
  FAILED: { icon: "x", label: "失败", cls: "text-red-400" },
  CANCELLED: { icon: "ban", label: "已取消", cls: "text-gray-600" },
};

export interface VideoQueueModalProps {
  open: boolean;
  onClose: () => void;
  /** Optional batch of prompts to submit when the modal opens. */
  draftItems?: { prompt: string; params?: Record<string, unknown> }[];
  /** Called when a clip is clicked — lets the parent open its detail view. */
  onOpenTask?: (taskId: string) => void;
}

export function VideoQueueModal({ open, onClose, draftItems = [], onOpenTask }: VideoQueueModalProps) {
  const [tasks, setTasks] = useState<VideoTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<{ prompt: string; params?: Record<string, unknown> }[]>([]);
  const [tab, setTab] = useState<"queue" | "draft">("queue");
  const submittedRef = useRef(false);

  const loadTasks = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      const data = await vanillaApi.task.list.query({ take: 200 });
      const all: any[] = data.tasks ?? [];
      const videos: VideoTask[] = all
        .filter((task) => task.type === "VIDEO")
        .map((task) => {
          const video = (task.images ?? []).find((im: any) => isVideo(im.localPath));
          return {
            id: task.id,
            status: task.status,
            prompt: task.prompt,
            workflowName: task.workflowName,
            video: video?.localPath ?? null,
            error: task.error ?? null,
          } as VideoTask;
        });
      setTasks(videos);
    } catch {
      setError("加载队列失败");
    } finally {
      setLoading(false);
    }
  }, [open]);

  // Initial load + poll every 4s while open (VIDEO tasks take a while).
  useEffect(() => {
    if (!open) return;
    submittedRef.current = false;
    const t = setInterval(loadTasks, 4000);
    // Defer the first fetch out of the effect body (React 19 rule:
    // no setState synchronously within an effect).
    const first = setTimeout(() => void loadTasks(), 0);
    return () => {
      clearInterval(t);
      clearTimeout(first);
    };
  }, [open, loadTasks]);

  // When draft items arrive, seed the draft editor and switch to the draft tab
  // (adjusted during render, React 19 pattern).
  const [prevSeedOpen, setPrevSeedOpen] = useState(open);
  const [prevSeedDraftItems, setPrevSeedDraftItems] = useState(draftItems);
  if ((open !== prevSeedOpen || draftItems !== prevSeedDraftItems) && open && draftItems.length) {
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
          const d = await vanillaApi.generate.generate.mutate({
            ...it.params,
            prompt: it.prompt,
          } as any);
          if (d.taskId) ok++;
        } catch {
          /* skip failed item */
        }
      }
      if (ok > 0) {
        setDraft([]);
        setTab("queue");
        loadTasks();
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

  const runningCount = tasks.filter((task) => task.status === "RUNNING" || task.status === "QUEUED").length;

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[var(--color-node)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/6 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <h3 className="u-title">视频生成队列</h3>
            {runningCount > 0 && (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-400">
                {runningCount} 个进行中
              </span>
            )}
            <button
              type="button"
              onClick={loadTasks}
              className="text-[11px] text-gray-500 transition-colors hover:text-violet-300"
              title="刷新"
            >
              ↻ 刷新
            </button>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg bg-white/[0.04] p-0.5">
              <button
                type="button"
                onClick={() => setTab("queue")}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  tab === "queue" ? "bg-white/10 text-gray-100" : "text-gray-500 hover:text-gray-300"
                }`}
              >
                生成队列
              </button>
              <button
                type="button"
                onClick={() => setTab("draft")}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  tab === "draft" ? "bg-white/10 text-gray-100" : "text-gray-500 hover:text-gray-300"
                }`}
              >
                批量提交（{draft.length}）
              </button>
            </div>
            <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-300" aria-label="关闭">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === "queue" ? (
            <div className="space-y-3">
              {loading && tasks.length === 0 ? (
                <p className="py-10 text-center text-xs text-gray-600">加载中…</p>
              ) : tasks.length === 0 ? (
                <p className="py-10 text-center text-xs text-gray-600">
                  暂无视频生成任务。切到「批量提交」添加分镜，或在创作台「视频」模式直接生成。
                </p>
              ) : (
                tasks.map((task, index) => {
                  const meta = STATUS_META[task.status] ?? STATUS_META.QUEUED;
                  return (
                    <div
                      key={task.id}
                      className="flex items-center gap-3 rounded-xl border border-white/6 bg-white/[0.02] p-3"
                    >
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black/40">
                        {task.video ? (
                          <MediaThumbnail
                            src={task.video}
                            alt={`V${String(index + 1).padStart(2, "0")}`}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <Icon name="film" size={18} className="text-gray-500" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="mb-0.5 flex items-center gap-2">
                          <span className="font-mono text-xs text-violet-300">V{String(index + 1).padStart(2, "0")}</span>
                          <span className={`inline-flex items-center gap-1 text-xs ${meta!.cls}`}>
                            <Icon name={meta!.icon} size={13} />
                            {meta!.label}
                          </span>
                        </div>
                        <p
                          className="truncate text-xs text-gray-400"
                          title={task.prompt}
                        >
                          {task.prompt || "（无提示词）"}
                        </p>
                        <p className="mt-0.5 truncate font-mono text-[10px] text-gray-600">{task.workflowName}</p>
                        {task.status === "FAILED" && task.error && (
                          <p className="mt-0.5 truncate text-[10px] text-red-400" title={task.error}>{task.error}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <button
                          type="button"
                          onClick={() => onOpenTask?.(task.id)}
                          className="rounded-md border border-white/10 px-2.5 py-1 text-[11px] text-gray-300 transition-colors hover:bg-white/5"
                        >
                          详情
                        </button>
                        {task.video && (
                          <a
                            href={task.video}
                            download
                            className="rounded-md bg-violet-500/20 px-2.5 py-1 text-[11px] text-violet-300 transition-colors hover:bg-violet-500/30"
                          >
                            下载
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              {error && <p className="text-center text-xs text-red-400">{error}</p>}
            </div>
          ) : (
            <div className="space-y-3">
              {draft.length === 0 ? (
                <p className="py-8 text-center text-xs text-gray-600">
                  暂无待提交分镜。在下方逐个添加提示词（每行一个），或粘贴工坊分镜批量导入。
                </p>
              ) : (
                draft.map((draftItem, index) => (
                  <div key={`draft-${index}`} className="flex items-start gap-2 rounded-xl border border-white/6 bg-white/[0.02] p-3">
                    <span className="mt-1 font-mono text-xs text-violet-300">V{String(index + 1).padStart(2, "0")}</span>
                    <textarea
                      value={draftItem.prompt}
                      onChange={(event) =>
                        setDraft((arr) => arr.map((item, idx) => (idx === index ? { ...item, prompt: event.target.value } : item)))
                      }
                      rows={2}
                      placeholder="分镜提示词，含镜头运动描述…"
                      className="min-w-0 flex-1 resize-none rounded-lg border border-white/8 bg-white/[0.04] px-3 py-2 text-xs text-gray-200 outline-none placeholder:text-gray-600 focus:border-violet-500/40"
                    />
                    <button
                      type="button"
                      onClick={() => setDraft((arr) => arr.filter((_, j) => j !== index))}
                      className="mt-1 text-gray-500 transition-colors hover:text-red-400"
                      aria-label="删除"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
                      </svg>
                    </button>
                  </div>
                ))
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setDraft((arr) => [...arr, { prompt: "" }])}
                  className="rounded-lg border border-dashed border-white/10 px-3 py-1.5 text-xs text-gray-400 transition-colors hover:border-violet-500/30 hover:text-violet-300"
                >
                  ＋ 添加一行
                </button>
                <input
                  type="file"
                  accept=".txt,.csv"
                  className="hidden"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    const text = await file.text();
                    const lines = text.split(/\r?\n/).map((segment) => segment.trim()).filter(Boolean);
                    setDraft((arr) => [...arr, ...lines.map((prompt) => ({ prompt }))]);
                  }}
                  id="vq-import"
                />
                <label
                  htmlFor="vq-import"
                  className="cursor-pointer rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-400 transition-colors hover:bg-white/5"
                >
                  导入 txt/csv
                </label>
              </div>

              {error && <p className="text-center text-xs text-red-400">{error}</p>}
            </div>
          )}
        </div>

        {/* Footer */}
        {tab === "draft" && (
          <div className="flex items-center justify-between border-t border-white/6 px-5 py-3.5">
            <span className="text-[11px] text-gray-500">提交后将进入「生成队列」并实时刷新</span>
            <button
              type="button"
              onClick={submitDrafts}
              disabled={submitting || draft.filter((draft) => draft.prompt.trim()).length === 0}
              className="rounded-lg bg-violet-500 px-5 py-2 text-xs font-medium text-white transition-opacity hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {submitting ? "提交中…" : `开始生成（${draft.filter((draft) => draft.prompt.trim()).length}）`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
