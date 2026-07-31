"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/updream/Toast";
import { MediaThumb, isVideo } from "@/components/updream/MediaThumb";

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
  return `${Math.floor(h / 24)} 天前`;
}

export function WorksGallery({ onOpenTask }: { onOpenTask?: (id: string) => void }) {
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

  const remove = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("已删除作品");
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
      <div className="mx-auto max-w-[1200px] px-8 py-10">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-100">我的作品</h1>
            <p className="mt-1 text-sm text-gray-500">本机 ComfyUI 生成的所有结果，按时间倒序排列。</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={load}
              className="rounded-lg border border-white/10 px-3 py-2 text-xs text-gray-400 hover:text-gray-200"
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

        {loading ? (
          <p className="text-sm text-gray-500">加载中…</p>
        ) : tasks.length === 0 ? (
          <div className="grid min-h-[300px] place-items-center rounded-2xl border border-dashed border-white/[0.08] text-gray-500">
            <div className="text-center">
              <p className="text-lg font-medium text-gray-300">还没有作品</p>
              <p className="mt-1 text-sm">点击右上角「新建创作」生成你的第一张图吧。</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {tasks.map((t) => {
              const st = STATUS[t.status] ?? STATUS.QUEUED;
              return (
                <div
                  key={t.id}
                  className="group overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] text-left transition-all hover:border-white/[0.14] hover:shadow-lg hover:shadow-black/30"
                >
                  <button
                    type="button"
                    onClick={() => openDetail(t.id)}
                    className="relative block aspect-square w-full bg-[#111118]"
                  >
                    {t.cover ? (
                      <MediaThumb
                        src={t.cover}
                        alt={t.prompt}
                        className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
                        autoPlay
                        loop
                      />
                    ) : (
                      <div className="grid h-full place-items-center text-xs text-gray-600">
                        {t.status === "FAILED" ? "生成失败" : "无预览"}
                      </div>
                    )}
                    <span className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>
                      {st.label}
                    </span>
                  </button>
                  <div className="p-3">
                    <p className="line-clamp-2 text-xs text-gray-400">{t.prompt || "（无提示词）"}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-[11px] text-gray-600">{timeAgo(t.createdAt)}</span>
                      <button
                        onClick={() => remove(t.id)}
                        className="rounded px-1.5 py-0.5 text-[11px] text-gray-500 opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-300 group-hover:opacity-100"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail modal */}
      {detailId && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-6"
          onClick={() => setDetailId(null)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#101018]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
              <h3 className="text-sm font-semibold text-gray-100">作品详情</h3>
              <button onClick={() => setDetailId(null)} className="text-gray-500 hover:text-gray-200">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
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
                          <MediaThumb
                            src={img.localPath}
                            alt=""
                            className="aspect-square w-full object-cover"
                            autoPlay
                            loop
                          />
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
                  {detail.error && (
                    <p className="rounded-lg bg-red-500/10 p-2.5 text-xs text-red-300">错误：{detail.error}</p>
                  )}
                  <button
                    onClick={() => remove(detail.id)}
                    className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10"
                  >
                    删除此作品
                  </button>
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
