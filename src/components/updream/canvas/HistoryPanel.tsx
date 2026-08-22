"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { MediaThumb } from "@/components/updream/MediaThumb";
import { vanillaApi } from "~/trpc/vanilla";

/* ── Types (mirror /api/tasks 响应) ─────────────────────────── */

type HistoryFilter = "all" | "image" | "video" | "audio";
type HistoryScope = "project" | "all";
type DisplayMode = "grid" | "list";

interface TaskRow {
  id: string;
  type: string;
  workflowName: string;
  status: string;
  prompt: string;
  createdAt: string;
  cover: string | null;
  mediaType: "image" | "video" | "audio";
  projectId: string | null;
  progress: number;
  error: string | null;
}

/* ── Helpers ───────────────────────────────────────────────── */

const STATUS_PILL: Record<string, { label: string; cls: string }> = {
  QUEUED: { label: "排队中", cls: "bg-cyan-500/15 text-cyan-300" },
  RUNNING: { label: "生成中", cls: "bg-violet-500/20 text-violet-300" },
  FAILED: { label: "失败", cls: "bg-red-500/15 text-red-400" },
  CANCELLED: { label: "已取消", cls: "bg-white/10 text-gray-400" },
};

const KIND_STYLE: Record<TaskRow["mediaType"], string> = {
  image: "bg-violet-500/10 text-violet-400",
  video: "bg-blue-500/10 text-blue-400",
  audio: "bg-emerald-500/10 text-emerald-400",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

/** 卡片主标题：优先提示词摘要，退回工作流名，最后退回任务 id 短码。 */
function titleOf(t: TaskRow): string {
  const p = t.prompt?.trim();
  if (p) return p.length > 40 ? `${p.slice(0, 40)}…` : p;
  if (t.workflowName) return t.workflowName;
  return t.id.slice(0, 12);
}

function KindIcon({ kind }: { kind: TaskRow["mediaType"] }) {
  const c = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (kind === "video")
    return (
      <svg {...c}>
        <polygon points="23 7 16 12 23 17 23 7" />
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      </svg>
    );
  if (kind === "audio")
    return (
      <svg {...c}>
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    );
  return (
    <svg {...c}>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

/* ── Component ─────────────────────────────────────────────── */

interface HistoryPanelProps {
  onClose: () => void;
  /** 当前画布项目 id；有值时默认只看本项目记录。 */
  projectId?: string | null;
  /** 把历史产出投放到画布（由 ProjectCanvas 实现建节点）。 */
  onUse?: (task: { id: string; cover: string; mediaType: "image" | "video" | "audio" }) => void;
}

export function HistoryPanel({ onClose, projectId, onUse }: HistoryPanelProps) {
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [scope, setScope] = useState<HistoryScope>(projectId ? "project" : "all");
  const [display, setDisplay] = useState<DisplayMode>("list");

  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  /** 全局是否有记录 —— 本项目为空时用来决定是否提示「查看全部」。 */
  const [globalCount, setGlobalCount] = useState<number | null>(null);

  /* ── 拉取任务 ── */
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      const params: { take?: number; projectId?: string; media?: "image" | "video" | "audio" } = { take: 80 };
      if (scope === "project" && projectId) params.projectId = projectId;
      if (filter !== "all") params.media = filter as "image" | "video" | "audio";
      try {
        const d = await vanillaApi.task.list.query(params);
        if (cancelled) return;
        setTasks((d.tasks ?? []) as unknown as TaskRow[]);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message ?? "读取历史记录失败");
        setTasks([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [projectId, scope, filter, reloadKey]);

  /* ── 本项目为空时探一次全局，以便给出「查看全部」引导 ── */
  useEffect(() => {
    if (scope !== "project" || loading || tasks.length > 0 || globalCount !== null) return;
    let cancelled = false;
    vanillaApi.task.list
      .query({ take: 1 })
      .then((d) => {
        if (cancelled || !d) return;
        setGlobalCount(Array.isArray(d.tasks) ? d.tasks.length : 0);
      })
      .catch(() => {
        /* 探测失败不影响主流程 */
      });
    return () => {
      cancelled = true;
    };
  }, [scope, loading, tasks.length, globalCount]);

  /* ── 有任务在跑时轮询（4s），跑完自动停 ── */
  const activeCount = tasks.filter(
    (t) => t.status === "RUNNING" || t.status === "QUEUED"
  ).length;
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (activeCount === 0) return;
    const timer = setInterval(() => refreshRef.current(), 4000);
    return () => clearInterval(timer);
  }, [activeCount]);

  const filterTabs: { id: HistoryFilter; label: string }[] = [
    { id: "all", label: "全部" },
    { id: "image", label: "图片" },
    { id: "video", label: "视频" },
    { id: "audio", label: "音频" },
  ];

  return (
    <aside className="flex h-full w-[360px] shrink-0 flex-col overflow-hidden border-l border-white/[0.06] bg-[#14141a]/98 backdrop-blur-md">
      {/* ── Header ── */}
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
        <h2 className="flex-1 text-[15px] font-semibold text-gray-100">历史记录</h2>
        {activeCount > 0 && (
          <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] text-violet-300">
            {activeCount} 进行中
          </span>
        )}
        <button
          type="button"
          onClick={refresh}
          className="flex h-6 w-6 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-white/[0.06] hover:text-gray-300"
          title="刷新"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" />
          </svg>
        </button>
        {/* 显示密度切换 */}
        <div className="flex items-center gap-0.5 rounded-lg bg-white/[0.04] p-0.5">
          <button
            type="button"
            onClick={() => setDisplay("grid")}
            className={`rounded-md p-1 transition-colors ${display === "grid" ? "bg-white/10 text-gray-200" : "text-gray-500 hover:text-gray-300"}`}
            title="网格视图"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setDisplay("list")}
            className={`rounded-md p-1 transition-colors ${display === "list" ? "bg-white/10 text-gray-200" : "text-gray-500 hover:text-gray-300"}`}
            title="列表视图"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-white/[0.06] hover:text-gray-300"
          title="关闭"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* ── 作用域切换（仅在有项目时出现）── */}
      {projectId && (
        <div className="flex gap-4 border-b border-white/[0.06] px-4 pt-2">
          {([
            { id: "project" as HistoryScope, label: "本项目" },
            { id: "all" as HistoryScope, label: "全部" },
          ]).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setScope(s.id)}
              className={`pb-2.5 text-[13px] font-medium transition-colors ${
                scope === s.id
                  ? "border-b-2 border-[#FF5CA8] text-gray-100"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* ── 类型筛选（pill）── */}
      <div className="flex gap-1.5 px-4 py-3">
        {filterTabs.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition-all ${
              filter === f.id
                ? "bg-white/12 text-gray-100 ring-1 ring-white/10"
                : "text-gray-500 hover:bg-white/[0.04] hover:text-gray-300"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="mx-4 mb-2 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
          <span className="min-w-0 flex-1 break-words text-[11px] text-red-300">{error}</span>
          <button
            type="button"
            onClick={refresh}
            className="shrink-0 text-[11px] text-red-200 underline transition-colors hover:text-red-100"
          >
            重试
          </button>
        </div>
      )}

      {/* ── Content ── */}
      <div className="min-w-0 flex-1 overflow-y-auto px-2 pb-4">
        {loading ? (
          <div className="space-y-1 px-2 pt-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-2">
                <div className="h-10 w-10 shrink-0 animate-pulse rounded-md bg-white/[0.05]" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="h-3 w-3/4 animate-pulse rounded bg-white/[0.05]" />
                  <div className="h-2 w-1/3 animate-pulse rounded bg-white/[0.04]" />
                </div>
              </div>
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-[12px] text-gray-600">
              {scope === "project" ? "本项目还没有生成记录" : "暂无历史记录"}
            </p>
            {scope === "project" && globalCount !== null && globalCount > 0 && (
              <button
                type="button"
                onClick={() => setScope("all")}
                className="mt-3 rounded-lg border border-white/[0.08] px-3 py-1.5 text-[11px] text-gray-400 transition-colors hover:bg-white/[0.04] hover:text-gray-200"
              >
                查看全部记录
              </button>
            )}
          </div>
        ) : display === "grid" ? (
          /* 网格视图 */
          <div className="grid grid-cols-2 gap-2 px-1 pt-1">
            {tasks.map((t) => {
              const pill = STATUS_PILL[t.status];
              return (
                <div
                  key={t.id}
                  draggable={!!t.cover && (t.mediaType === "image" || t.mediaType === "video")}
                  onDragStart={(e) => {
                    if (!t.cover) return;
                    e.dataTransfer.setData(
                      "application/x-comfyapp-media",
                      JSON.stringify({
                        url: t.cover,
                        displayName: t.cover.split("/").pop() || t.id,
                        mediaType: t.mediaType,
                      })
                    );
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  className={`group relative overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.02] ${
                    t.cover && (t.mediaType === "image" || t.mediaType === "video")
                      ? "cursor-grab active:cursor-grabbing"
                      : ""
                  }`}
                >
                  <div className="flex aspect-square items-center justify-center overflow-hidden bg-black/20">
                    {t.cover ? (
                      <MediaThumb src={t.cover} alt={titleOf(t)} className="h-full w-full object-cover" />
                    ) : (
                      <div className={`flex h-12 w-12 items-center justify-center rounded-lg ${KIND_STYLE[t.mediaType]}`}>
                        <KindIcon kind={t.mediaType} />
                      </div>
                    )}
                  </div>
                  {pill && (
                    <span className={`absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[9px] ${pill.cls}`}>
                      {pill.label}
                    </span>
                  )}
                  <p className="truncate px-2 py-1.5 text-[11px] text-gray-300">{titleOf(t)}</p>
                  {onUse && t.cover && (
                    <button
                      type="button"
                      onClick={() => onUse({ id: t.id, cover: t.cover!, mediaType: t.mediaType })}
                      className="absolute right-1 top-1 hidden h-6 w-6 items-center justify-center rounded bg-black/60 text-gray-300 backdrop-blur transition-colors hover:text-white group-hover:flex"
                      title="加入画布"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* 列表视图 */
          <div className="space-y-0.5">
            {tasks.map((t) => {
              const pill = STATUS_PILL[t.status];
              return (
                <div
                  key={t.id}
                  draggable={!!t.cover && (t.mediaType === "image" || t.mediaType === "video")}
                  onDragStart={(e) => {
                    if (!t.cover) return;
                    e.dataTransfer.setData(
                      "application/x-comfyapp-media",
                      JSON.stringify({
                        url: t.cover,
                        displayName: t.cover.split("/").pop() || t.id,
                        mediaType: t.mediaType,
                      })
                    );
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  className={`group flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-white/[0.04] ${
                    t.cover && (t.mediaType === "image" || t.mediaType === "video")
                      ? "cursor-grab active:cursor-grabbing"
                      : ""
                  }`}
                >
                  {/* 缩略图 / 类型占位 */}
                  {t.cover ? (
                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-black/20">
                      <MediaThumb src={t.cover} alt={titleOf(t)} className="h-full w-full object-cover" />
                    </div>
                  ) : (
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${KIND_STYLE[t.mediaType]}`}>
                      <KindIcon kind={t.mediaType} />
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-gray-200">{titleOf(t)}</p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span className="text-[11px] text-gray-600">{timeAgo(t.createdAt)}</span>
                      {pill && (
                        <span className={`rounded px-1.5 py-0.5 text-[9px] ${pill.cls}`}>
                          {pill.label}
                        </span>
                      )}
                      {t.status === "FAILED" && t.error && (
                        <span className="min-w-0 truncate text-[10px] text-red-400/70" title={t.error}>
                          {t.error}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="hidden shrink-0 items-center gap-1 pr-1 group-hover:flex">
                    {onUse && t.cover && (
                      <button
                        type="button"
                        onClick={() => onUse({ id: t.id, cover: t.cover!, mediaType: t.mediaType })}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-white/[0.08] hover:text-gray-200"
                        title="加入画布"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                      </button>
                    )}
                    {t.cover && (
                      <a
                        href={t.cover}
                        download
                        draggable={false}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-white/[0.08] hover:text-gray-200"
                        title="下载"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                        </svg>
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
