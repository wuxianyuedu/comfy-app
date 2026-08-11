"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/updream/Toast";
import { MediaThumb, isVideo } from "@/components/updream/MediaThumb";
import { AuroraBackground } from "@/components/updream/AuroraBackground";

interface TaskItem {
  id: string;
  type: string;
  workflowName: string;
  status: string;
  prompt: string;
  negativePrompt?: string | null;
  params?: Record<string, unknown> | null;
  createdAt: string;
  cover: string | null;
  coverIsCover?: boolean;
}

const STATUS: Record<string, { label: string; cls: string }> = {
  QUEUED: { label: "排队中", cls: "bg-white/10 text-gray-300" },
  RUNNING: { label: "生成中", cls: "bg-violet-500/20 text-violet-300" },
  SUCCEEDED: { label: "已完成", cls: "bg-emerald-500/15 text-emerald-400" },
  FAILED: { label: "失败", cls: "bg-red-500/15 text-red-400" },
  CANCELLED: { label: "已取消", cls: "bg-white/10 text-gray-400" },
};

function timeAgo(iso: string) {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const day = Math.floor(h / 24);
  return `${day} 天前`;
}

export function HistoryList({ onOpenTask }: { onOpenTask?: (id: string) => void }) {
  const toast = useToast();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((d) => setTasks(d.tasks ?? []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = useCallback((id: string) => {
    setDetailId(id);
    setDetailLoading(true);
    setDetail(null);
    fetch(`/api/tasks/${id}`)
      .then((r) => r.json())
      .then((d) => setDetail(d.task))
      .finally(() => setDetailLoading(false));
  }, []);

  // Allow external components (e.g. VideoQueueModal "详情") to open a task.
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id) openDetail(id);
    };
    window.addEventListener("open-task", handler);
    return () => window.removeEventListener("open-task", handler);
  }, [openDetail]);

  const cancel = useCallback(
    async (id: string) => {
      await fetch(`/api/tasks/${id}/cancel`, { method: "POST" });
      toast.info("已发送取消请求");
      load();
    },
    [load, toast]
  );

  const remove = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("已删除任务");
        setTasks((prev) => prev.filter((t) => t.id !== id));
        if (detailId === id) setDetailId(null);
      } else {
        toast.error("删除失败");
      }
    },
    [detailId, toast]
  );

  return (
    <div className="h-full overflow-y-auto">
      <AuroraBackground />
      <div className="mx-auto max-w-[1200px] px-4 sm:px-8 py-8 sm:py-10">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-title text-xl font-bold text-gray-100">历史记录</h1>
            <p className="mt-1 text-sm text-gray-500">所有生成任务与执行日志，按时间倒序排列。</p>
          </div>
          <button
            onClick={load}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200"
          >
            ↻ 刷新
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-gray-500">加载中…</p>
        ) : tasks.length === 0 ? (
          <div className="grid min-h-[300px] place-items-center rounded-2xl border border-dashed border-white/[0.08] text-gray-500">
            <div className="text-center">
              <p className="text-lg font-medium text-gray-300">暂无任务记录</p>
              <p className="mt-1 text-sm">在创作台生成内容后，历史记录会显示在这里。</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {tasks.map((t) => {
              const st = STATUS[t.status] ?? STATUS.QUEUED;
              const active = t.status === "RUNNING" || t.status === "QUEUED";
              return (
                <div
                  key={t.id}
                  className="group flex items-center gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3 transition-all hover:border-white/[0.14] hover:bg-white/[0.04]"
                >
                  <button
                    onClick={() => openDetail(t.id)}
                    className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#111118]"
                  >
                    {t.cover ? (
                      <MediaThumb src={t.cover} alt="" className="h-full w-full object-cover" autoPlay loop />
                    ) : (
                      <span className="text-xs text-gray-600">{t.status === "FAILED" ? "失败" : "无图"}</span>
                    )}
                  </button>

                  <div className="min-w-0 flex-1 cursor-pointer" onClick={() => openDetail(t.id)}>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>{st.label}</span>
                      <span className="text-xs text-gray-500">{t.workflowName}</span>
                      <span className="text-xs text-gray-600">· {timeAgo(t.createdAt)}</span>
                    </div>
                    <p className="mt-1 line-clamp-1 text-sm text-gray-300">{t.prompt || "（无提示词）"}</p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                    {active && (
                      <button
                        onClick={() => cancel(t.id)}
                        className="rounded-lg border border-amber-500/30 px-2.5 py-1 text-xs text-amber-300 hover:bg-amber-500/10"
                      >
                        取消
                      </button>
                    )}
                    <button
                      onClick={() => remove(t.id)}
                      className="rounded-lg border border-red-500/30 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/10"
                    >
                      删除
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail modal */}
      {detailId && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4 sm:p-6" onClick={() => setDetailId(null)}>
          <div
            className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#16161e]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
              <h3 className="u-title">任务详情</h3>
              <div className="flex items-center gap-2">
                {onOpenTask && detail && (
                  <button
                    onClick={() => onOpenTask(detail.id)}
                    className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-gray-200"
                  >
                    打开完整详情 ↗
                  </button>
                )}
                <button onClick={() => setDetailId(null)} className="text-gray-500 hover:text-gray-200">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {detailLoading ? (
                <p className="text-sm text-gray-500">加载中…</p>
              ) : detail ? (
                <div className="space-y-4">
                  {detail.images?.length > 0 ? (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {detail.images.map((img: any, i: number) => (
                        <div key={i} className="group relative overflow-hidden rounded-xl border border-white/[0.06]">
                          <MediaThumb src={img.localPath} alt="" className="aspect-square w-full object-cover" autoPlay loop />
                          <a
                            href={img.localPath}
                            download
                            className="absolute bottom-2 right-2 rounded bg-white/15 px-2 py-0.5 text-[11px] text-white opacity-0 transition-opacity hover:bg-white/25 group-hover:opacity-100"
                          >
                            {isVideo(img.localPath) ? "下载视频" : "下载"}
                          </a>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">该任务没有生成图像。</p>
                  )}

                  <div>
                    <p className="mb-1 text-xs font-semibold text-gray-400">正向提示词</p>
                    <p className="whitespace-pre-wrap text-sm text-gray-300">{detail.prompt || "—"}</p>
                  </div>
                  {detail.negativePrompt && (
                    <div>
                      <p className="mb-1 text-xs font-semibold text-gray-400">反向提示词</p>
                      <p className="whitespace-pre-wrap text-sm text-gray-400">{detail.negativePrompt}</p>
                    </div>
                  )}
                  {detail.params && (
                    <div>
                      <p className="mb-1 text-xs font-semibold text-gray-400">参数</p>
                      <pre className="overflow-x-auto rounded-lg border border-white/[0.06] bg-black/30 p-3 text-[11px] text-gray-400">
                        {JSON.stringify(detail.params, null, 2)}
                      </pre>
                    </div>
                  )}
                  {detail.error && (
                    <p className="rounded-lg bg-red-500/10 p-2.5 text-xs text-red-300">错误：{detail.error}</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-500">未找到任务。</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
