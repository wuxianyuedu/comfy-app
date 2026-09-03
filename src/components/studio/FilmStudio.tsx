"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Redo2, Undo2 } from "lucide-react";
import { useToast } from "./ToastProvider";
import { vanillaApi } from "~/trpc/vanilla";

/* ── Film Studio — Updream-style Video Editor (Ardot-aligned) ─
  Dark-themed timeline-based video editing studio.
  Matches Ardot design spec: dark-aurora (#0a0a0f) + violet #8B5CF6 accent.
  Rendered inside WorkspaceNav parent shell (sidebar provided externally).

  Layout (within shell):
  ┌──────────────────────────────────────────────────────────┐
  │ Top Toolbar: [project name] [undo|redo] … [▶] [导出成片]  │
  ├──────────┬───────────────────────────────┬───────────────┤
  │ Shot List│  Preview Canvas (16:9)       │  Props Panel  │
  │ (260px)  │  ┌─────────────────────┐     │  (280px)      │
  │          │  │    ▶ play overlay    │     │  镜头名称      │
  │ · shot 1 │  └─────────────────────┘     │  时长          │
  │ · shot 2 │                               │  生成模式      │
  │ · shot 3 │  Timeline                     │  转场效果      │
  │ [+ add]  │  ruler + video/sub/bgm tracks │  提示词        │
  ├──────────┴───────────────────────────────┴───────────────┤
  │ Status Bar: ● ComfyUI 本地已连接 · GPU 可用              │
  └──────────────────────────────────────────────────────────┘
*/

/* ── Types (preserved from original for API compatibility) ── */
type FilmStatus = "PARSING" | "GENERATING" | "COMPOSING" | "DONE" | "FAILED" | "CANCELLED";
type ShotStatus = "IDLE" | "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
type ShotMode = "txt2img" | "img2video" | "transition";

interface FilmShot {
  id: string;
  order: number;
  heading: string | null;
  prompt: string;
  status: ShotStatus;
  progress: number;
  videoPath: string | null;
  duration: number | null;
}

interface Film {
  id: string;
  title: string;
  script: string;
  type: string;
  styleSlug: string | null;
  size: string;
  fps: number;
  framesPerShot: number;
  subtitleOn: boolean;
  bgmName: string | null;
  status: FilmStatus;
  progress: number;
  finalVideo: string | null;
  error: string | null;
  logs: { t: number; level: string; msg: string }[] | null;
  shots: FilmShot[];
}

/** Extract `e.message` from an unknown thrown value (was `(e as any)?.message`). */
function errMsg(e: unknown, fallback: string): string {
  if (typeof e === "object" && e !== null && "message" in e) {
    const m: unknown = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return fallback;
}

/* ── Mock Data (visual design reference) ── */
interface ShotListItem {
  id: string;
  name: string;
  duration: string;
  mode: ShotMode;
  status: ShotStatus;
  selected?: boolean;
}

const MOCK_SHOTS: ShotListItem[] = [
  {
    id: "shot-1",
    name: "开场 · 城市全景",
    duration: "00:03.2",
    mode: "txt2img",
    status: "SUCCEEDED",
    selected: true,
  },
  {
    id: "shot-2",
    name: "人物特写 · 走向镜头",
    duration: "00:05.0",
    mode: "img2video",
    status: "RUNNING",
  },
  {
    id: "shot-3",
    name: "转场 · 溶解过渡",
    duration: "00:01.5",
    mode: "transition",
    status: "IDLE",
  },
];

interface TimelineClip {
  id: string;
  label: string;
  width: number; /* px proportion */
  colorClass: string;
  textColorClass: string;
}

const VIDEO_CLIPS: TimelineClip[] = [
  { id: "vc-1", label: "开场全景", width: 180, colorClass: "from-violet-600 to-indigo-600", textColorClass: "text-[#e0d4fc]" },
  { id: "vc-2", label: "人物特写", width: 220, colorClass: "from-amber-500 to-red-500", textColorClass: "text-[#fce4c4]" },
];

const MODE_LABELS: Record<ShotMode, string> = {
  txt2img: "文生图首帧",
  img2video: "图生视频",
  transition: "自动转场",
};

const STATUS_BADGE: Record<ShotStatus, { bg: string; text: string; label: string }> = {
  IDLE: { bg: "bg-white/6", text: "text-(--color-ink-fainter)", label: "待处理" },
  QUEUED: { bg: "bg-amber-500/15", text: "text-amber-300", label: "排队中" },
  RUNNING: { bg: "bg-violet-500/15", text: "text-violet-300", label: "生成中" },
  SUCCEEDED: { bg: "bg-emerald-500/15", text: "text-emerald-300", label: "完成" },
  FAILED: { bg: "bg-rose-500/15", text: "text-rose-300", label: "失败" },
};

const STAGE_LABEL: Record<FilmStatus, string> = {
  PARSING: "分镜解析中",
  GENERATING: "逐镜生成视频中",
  COMPOSING: "合成完整影片中",
  DONE: "影片已完成",
  FAILED: "生成失败",
  CANCELLED: "已取消",
};

/* ── Component ── */
export function FilmStudio() {
  const { success, error, info } = useToast();

  /* ── Original business state (preserved) ── */
  const [title] = useState("未命名成片");
  const [script, setScript] = useState(
    "清晨，老咖啡馆里，一位老人正在擦拭相框。阳光斜照进来，他想起年轻时的约定。门外，一个熟悉的身影出现……"
  );
  const [type] = useState("short_video");
  const [styleSlug] = useState("");
  const [size] = useState("1280x720");
  const [fps] = useState(16);
  const [frames] = useState(49);
  const [subtitleOn, setSubtitleOn] = useState(true);
  const [bgmName, setBgmName] = useState<string | null>(null);
  const [, setSkills] = useState<{ slug: string; name: string }[]>([]);
  const [ffmpegAvailable, setFfmpegAvailable] = useState(true);

  /* ── New visual-editor state ── */
  const [shots, setShots] = useState<ShotListItem[]>(MOCK_SHOTS);
  const [selectedShotId, setSelectedShotId] = useState<string>("shot-1");
  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadPos] = useState(180); /* px from timeline left */

  /* ── Film API state (preserved) ── */
  const [film, setFilm] = useState<Film | null>(null);
  const [, setRecent] = useState<{ id: string; title: string; status: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── Derived ── */
  const selectedShot = shots.find((shot) => shot.id === selectedShotId) ?? shots[0];
  const running = film && (film.status === "GENERATING" || film.status === "COMPOSING" || film.status === "PARSING");

  /* ── API: load skills + recent films ── */
  const refreshMeta = useCallback(async () => {
    try {
      const [sData, fData] = await Promise.all([
        vanillaApi.skill.list.query(),
        vanillaApi.film.list.query(),
      ]);
      // skill.list returns `{...record, tags}` rows (index signature lost by
      // the router spread) — read slug/name off the record view.  Values are
      // asserted (not coerced) so malformed payloads behave exactly as before.
      const rawList: unknown = sData.skills;
      const list = Array.isArray(rawList) ? rawList : [];
      setSkills(
        list.map((raw) => {
          const s = raw as Record<string, unknown>;
          return { slug: s.slug as string, name: s.name as string };
        })
      );
      setFfmpegAvailable(!!fData.ffmpegAvailable);
      setRecent((fData.films ?? []));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    // Defer the initial meta fetch out of the effect body (React 19 rule:
    // no setState synchronously within an effect).
    const t = setTimeout(() => void refreshMeta(), 0);
    return () => clearTimeout(t);
  }, [refreshMeta]);

  /* ── Polling (preserved) ── */
  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const fetchDetail = useCallback(async (id: string) => {
    // Local recursive poller — referencing `fetchDetail` itself from inside
    // its own useCallback would make the memoisation unverifiable by the
    // React Compiler (rh/preserve-manual-memoization); a local function
    // keeps the same polling semantics without the self reference.
    const poll = async (tid: string): Promise<void> => {
      try {
        const data = await vanillaApi.film.detail.query({ id: tid });
        // /api/film/[id] 返回原始 Prisma FilmProject 行（status/logs/shots 比本地
        // `Film` 视图类型更宽，shape 由路由固定）；经 unknown 收窄为 UI 视图类型。
        const f: Film = data.film as unknown as Film;
        setFilm(f);
        if (f.status === "GENERATING" || f.status === "COMPOSING" || f.status === "PARSING") {
          pollRef.current ??= setInterval(() => void poll(tid), 3000);
        } else {
          stopPoll();
        }
      } catch {
        /* ignore */
      }
    };
    await poll(id);
  }, [stopPoll]);

  useEffect(() => () => stopPoll(), [stopPoll]);

  /* ── Actions (preserved) ── */
  const handleCreate = useCallback(async () => {
    if (!script.trim()) { error("请先输入剧本或创意"); return; }
    setLoading(true);
    try {
      stopPoll();
      const { id } = await vanillaApi.film.create.mutate({
        title,
        script,
        type,
        styleSlug: styleSlug || null,
        size,
        fps,
        framesPerShot: frames,
        subtitleOn,
        bgmName,
      });
      await vanillaApi.film.start.mutate({ id });
      await fetchDetail(id);
      success("已启动一键成片，正在逐镜生成…");
    } catch (e) { error(errMsg(e, "启动失败")); }
    finally { setLoading(false); }
  }, [script, title, type, styleSlug, size, fps, frames, subtitleOn, bgmName, stopPoll, fetchDetail, error, success]);

  const handleCancel = useCallback(async () => {
    if (!film) return;
    await vanillaApi.film.cancel.mutate({ id: film.id });
    stopPoll();
    await fetchDetail(film.id);
    info("已取消");
  }, [film, stopPoll, fetchDetail, info]);

  const handleRecompose = useCallback(async () => {
    if (!film) return;
    setLoading(true);
    try { await vanillaApi.film.compose.mutate({ id: film.id }); await fetchDetail(film.id); }
    finally { setLoading(false); }
  }, [film, fetchDetail]);

  const handleBgm = useCallback(async (file: File) => {
    const form = new FormData(); form.append("file", file);
    const res = await fetch("/api/film/bgm", { method: "POST", body: form });
    if (!res.ok) { error("BGM 上传失败"); return; }
    const d: unknown = await res.json();
    const name =
      typeof d === "object" && d !== null && "name" in d && typeof (d as { name?: unknown }).name === "string"
        ? (d as { name: string }).name
        : null;
    setBgmName(name); success("背景音乐已上传");
  }, [error, success]);

  /* ── Visual-editor actions ── */
  const handleSelectShot = useCallback((id: string) => {
    setSelectedShotId(id);
    setShots((prev) => prev.map((prev) =>({ ...prev, selected: prev.id === id })));
  }, []);

  const handleAddShot = useCallback(() => {
    const newId = `shot-${Date.now()}`;
    const newShot: ShotListItem = {
      id: newId,
      name: `镜头 ${shots.length + 1}`,
      duration: "00:03.0",
      mode: "img2video",
      status: "IDLE",
    };
    setShots((prev) => [...prev.map((prev) =>({ ...prev, selected: false })), newShot]);
    setSelectedShotId(newId);
  }, [shots.length]);

  const handleTogglePlay = useCallback(() => {
    setIsPlaying((value) => !value);
  }, []);

  const handleUndo = useCallback(() => {
    info("撤销", "时间轴编辑历史功能即将上线");
  }, [info]);

  const handleRedo = useCallback(() => {
    info("重做", "时间轴编辑历史功能即将上线");
  }, [info]);

  /* ── Render ── */
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-(--color-canvas)" style={{ fontFamily: "var(--font-sans)" }}>
      {/* ── Aurora Background Blobs ───────────────── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div
          className="absolute right-[-10%] top-[-20%] h-[70%] w-[55%] rounded-full opacity-50 mix-blend-screen"
          style={{ background: "radial-gradient(circle, rgba(139,92,246,0.42) 0%, rgba(139,92,246,0) 70%)" }}
        />
        <div
          className="absolute left-[-15%] bottom-[15%] h-[55%] w-[45%] rounded-full opacity-50 mix-blend-screen"
          style={{ background: "radial-gradient(circle, rgba(34,211,238,0.28) 0%, rgba(34,211,238,0) 70%)" }}
        />
      </div>

      {/* ── Top Toolbar ─────────────────────────────── */}
      <header className="relative z-10 flex shrink-0 items-center gap-3 border-b border-white/5 bg-(--color-panel)/88 px-4 py-0 backdrop-blur-md">
        {/* Project name */}
        <div className="flex items-center gap-2">
          <span className="u-title">{title}</span>
          <span className="text-xs text-(--color-ink-fainter)">· 视频成片工作室</span>
        </div>

        <div className="h-5 w-px bg-white/6" />

        {/* Undo / Redo */}
        <button type="button" onClick={handleUndo} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-white/5 hover:text-gray-300" title="撤销">
          <Undo2 size={16} />
        </button>
        <button type="button" onClick={handleRedo} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-white/5 hover:text-gray-300" title="重做">
          <Redo2 size={16} />
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Play button */}
        <button
          type="button"
          onClick={handleTogglePlay}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/85 text-white shadow-sm shadow-violet-500/20 transition-all hover:bg-violet-500 hover:shadow-violet-500/30 active:scale-95"
          title={isPlaying ? "暂停" : "播放预览"}
        >
          {isPlaying ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          )}
        </button>

        <div className="w-3" />

        {/* Zoom label + Export */}
        <span className="text-[11px] text-(--color-ink-faintest)">时间轴缩放</span>
        <button
          type="button"
          onClick={handleCreate}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-violet-500/35 bg-white/3 px-3.5 py-1.5 text-xs font-semibold text-[#c4b5fd] transition-all hover:border-violet-500/55 hover:bg-violet-500/8 disabled:opacity-50"
        >
          {loading ? "启动中…" : "导出成片"}
        </button>

        {/* Cancel button (when running) */}
        {film && running && (
          <button
            onClick={handleCancel}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-white/6"
          >
            取消
          </button>
        )}
      </header>

      {/* ── Three-Column Body ───────────────────────── */}
      <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden">

        {/* ═══ Left: Shot List Panel (260px) ═══ */}
        <aside className="flex w-[260px] shrink-0 flex-col border-r border-white/4 bg-(--color-panel-deep)/85 backdrop-blur-sm">
          {/* Header */}
          <div className="flex h-11 items-center justify-between border-b border-white/4 px-4">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-(--color-ink-field)">分镜列表</span>
              <span className="text-[11px] text-(--color-ink-fainter)">{shots.length} 镜头</span>
            </div>
            <button
              type="button"
              onClick={handleAddShot}
              className="flex h-6 w-6 items-center justify-center rounded-md border border-violet-500/30 bg-violet-500/12 text-sm text-violet-400 transition-colors hover:border-violet-500/50 hover:bg-violet-500/20"
              title="新增镜头"
            >
              +
            </button>
          </div>

          {/* Shot items */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {shots.map((shot) => {
              const badge = STATUS_BADGE[shot.status];
              const isSelected = shot.id === selectedShotId;
              return (
                <button
                  key={shot.id}
                  type="button"
                  onClick={() => handleSelectShot(shot.id)}
                  className={`group flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition-all ${
                    isSelected
                      ? "border-violet-500/40 bg-violet-500/12 shadow-sm shadow-black/10"
                      : "border-transparent bg-white/2 hover:border-white/8 hover:bg-white/4"
                  }`}
                >
                  {/* Thumbnail placeholder */}
                  <div className={`flex h-12 w-[56px] shrink-0 items-center justify-center rounded-md text-[10px] ${
                    isSelected ? "bg-violet-500/10 text-violet-400" : "bg-white/3 text-(--color-ink-faintest)"
                  }`}>
                    镜头缩略图
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-[12px] font-medium ${isSelected ? "text-(--color-ink-field)" : "text-[#b6bccf]"}`}>
                      {shot.name}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-[10px] text-(--color-ink-faintest)">{shot.duration}</span>
                      <span className="text-[10px] text-(--color-ink-faintest)">·</span>
                      <span className="text-[10px] text-(--color-ink-fainter)">{MODE_LABELS[shot.mode]}</span>
                    </div>
                  </div>

                  {/* Status badge */}
                  <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-medium ${badge.bg} ${badge.text}`}>
                    {badge.label}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* ═══ Center: Preview + Timeline ═══ */}
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden p-5 pb-3">
          {/* Preview Canvas */}
          <div className="relative mb-3 flex min-h-[320px] flex-1 items-center justify-center overflow-hidden rounded-2xl border border-white/6 bg-[#08080c]">
            {/* Resolution hint */}
            <span className="absolute left-3 top-2.5 rounded bg-black/50 px-2 py-0.5 text-[10px] font-mono text-(--color-ink-faintest) backdrop-blur-sm">
              {size} · {fps}fps
            </span>

            {/* Play overlay */}
            <button
              type="button"
              onClick={handleTogglePlay}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-black/45 border border-white/18 shadow-lg shadow-black/30 transition-all hover:scale-105 hover:bg-black/55 active:scale-95"
              title={isPlaying ? "暂停" : "播放"}
            >
              {isPlaying ? (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
              ) : (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z" /></svg>
              )}
            </button>

            {/* Film progress overlay (when generating) */}
            {film && running && (
              <div className="absolute bottom-0 left-0 right-0 bg-black/60 backdrop-blur-sm px-4 py-2.5">
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-gray-200">{STAGE_LABEL[film.status]}</span>
                  <span className="text-gray-400">{film.progress}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/8">
                  <div
                    className="h-full rounded-full bg-linear-to-r from-violet-500 to-fuchsia-500 transition-all"
                    style={{ width: `${film.progress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Final video player (when done) */}
            {film?.status === "DONE" && film.finalVideo && (
              <video
                src={film.finalVideo}
                controls
                autoPlay
                className="absolute inset-0 h-full w-full object-contain bg-black"
              />
            )}
          </div>

          {/* Timeline */}
          <div className="mt-auto rounded-xl border border-white/4 bg-(--color-panel-deep)/90 p-3 backdrop-blur-sm">
            {/* Time ruler */}
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-[10px] font-mono text-(--color-ink-faintest)">00:00</span>
              <span className="text-[10px] font-mono text-(--color-ink-faintest)">00:05</span>
              <span className="text-[10px] font-mono text-(--color-ink-faintest)">00:10</span>
            </div>

            {/* Tracks container */}
            <div className="space-y-1 relative">
              {/* Playhead */}
              <div
                className="pointer-events-none absolute bottom-0 z-10 w-[2px] bg-red-400/80"
                style={{ left: `${Math.min(playheadPos, 600)}px`, top: 0, height: "100%" }}
              >
                <div className="absolute left-[-7px] -top-1 h-[10px] w-4 rounded-sm bg-red-400/80" />
              </div>

              {/* Video track */}
              <div className="flex h-11 items-center gap-2 rounded-md bg-white/4 px-2">
                <span className="w-12 shrink-0 text-[10px] text-(--color-ink-faint)">视频轨</span>
                <div className="flex flex-1 gap-1.5">
                  {VIDEO_CLIPS.map((clip) => (
                    <div
                      key={clip.id}
                      className={`flex h-8 items-center rounded-md bg-linear-to-r ${clip.colorClass} px-2.5 shadow-sm`}
                      style={{ width: `${clip.width}px` }}
                    >
                      <span className={`text-[10px] font-semibold ${clip.textColorClass}`}>{clip.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Subtitle track */}
              <div className="flex h-9 items-center gap-2 rounded-md px-2">
                <span className="w-12 shrink-0 text-[10px] text-(--color-ink-fainter)">字幕轨</span>
                <div className="flex h-6 flex-1 items-center rounded bg-emerald-400/15 px-2.5 ring-1 ring-inset ring-emerald-400/25" style={{ width: "280px" }}>
                  <span className="truncate text-[9px] text-cyan-300">「城市在晨光中苏醒，镜头缓缓推进…」</span>
                </div>
              </div>

              {/* BGM / Audio track */}
              <div className="flex h-9 items-center gap-2 rounded-md px-2">
                <span className="w-12 shrink-0 text-[10px] text-(--color-ink-fainter)">BGM</span>
                <div className="flex h-6 flex-1 items-center rounded bg-linear-to-r from-blue-500/20 to-violet-500/20 px-2.5" style={{ width: "200px" }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5 shrink-0">
                    <path d="M9 18V5l12-2v13M9 18a3 3 0 01-3-3H3a3 3 0 006 3z" />
                  </svg>
                  <span className="truncate text-[9px] text-[#a78bfa]">{bgmName ?? "背景音乐 · 氛围感配乐"}</span>
                </div>
              </div>
            </div>
          </div>
        </main>

        {/* ═══ Right: Properties Panel (280px) ═══ */}
        <aside className="flex w-[280px] shrink-0 flex-col border-l border-white/4 bg-(--color-panel-deep)/85 backdrop-blur-sm">
          {/* Header */}
          <div className="flex h-11 items-center border-b border-white/4 px-4">
            <span className="text-[13px] font-semibold text-(--color-ink-field)">镜头属性</span>
          </div>

          {/* Form fields */}
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {/* Shot name */}
            <label className="block">
              <span className="mb-1.5 block text-[11px] text-(--color-ink-faint)">镜头名称</span>
              <input
                value={selectedShot!.name}
                onChange={(event) => setShots((prev) => prev.map((prev) =>prev.id === selectedShotId ? { ...prev, name: event.target.value } : prev))}
                className="h-9 w-full rounded-lg border border-white/8 bg-white/3 px-3 text-[13px] text-(--color-ink-field) outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20"
              />
            </label>

            {/* Duration */}
            <label className="block">
              <span className="mb-1.5 block text-[11px] text-(--color-ink-faint)">时长 (秒)</span>
              <input
                type="number"
                step="0.1"
                min="0.5"
                max="30"
                value={parseFloat(selectedShot!.duration)}
                onChange={(event) => setShots((prev) => prev.map((prev) =>prev.id === selectedShotId ? { ...prev, duration: `${Number(event.target.value).toFixed(1)}`.padStart(5, "0") } : prev))}
                className="h-9 w-full rounded-lg border border-white/8 bg-white/3 px-3 text-[13px] text-(--color-ink-field) outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20"
              />
            </label>

            {/* Mode select */}
            <label className="block">
              <span className="mb-1.5 block text-[11px] text-(--color-ink-faint)">生成模式</span>
              <div className="flex h-9 items-center rounded-lg border border-white/8 bg-white/3 px-3 text-[13px] text-(--color-ink-field)">
                图生视频 (Wan I2V)
              </div>
            </label>

            {/* Transition */}
            <label className="block">
              <span className="mb-1.5 block text-[11px] text-(--color-ink-faint)">转场效果</span>
              <div className="flex h-9 items-center rounded-lg border border-white/8 bg-white/3 px-3 text-[13px] text-[#b6bccf]">
                溶解过渡 (Cross Dissolve)
              </div>
            </label>

            {/* Prompt textarea */}
            <label className="block">
              <span className="mb-1.5 block text-[11px] text-(--color-ink-faint)">提示词 / 描述</span>
              <textarea
                rows={3}
                defaultValue="城市在晨光中苏醒，镜头缓缓推进，展现繁忙街道与远处天际线…"
                className="w-full resize-none rounded-lg border border-white/8 bg-white/3 px-3 py-2 text-[12px] leading-relaxed text-[#9aa0b5] outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20"
              />
            </label>

            {/* Divider */}
            <hr className="border-white/5" />

            {/* Global config: Script input (collapsed from original) */}
            <label className="block">
              <span className="mb-1.5 block text-[11px] text-(--color-ink-faint)">剧本 / 创意</span>
              <textarea
                value={script}
                onChange={(event) => setScript(event.target.value)}
                rows={3}
                placeholder="支持一句话自动分镜…"
                className="w-full resize-none rounded-lg border border-white/8 bg-white/3 px-3 py-2 text-[12px] leading-relaxed text-[#9aa0b5] outline-none placeholder:text-(--color-ink-faintest) focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20"
              />
            </label>

            {/* Subtitle toggle */}
            <label className="flex cursor-pointer items-center justify-between rounded-lg border border-white/8 bg-(--color-canvas)/60 px-3 py-2.5">
              <span className="text-sm text-(--color-ink-field)">烧录字幕</span>
              <input
                type="checkbox"
                checked={subtitleOn}
                onChange={(event) => setSubtitleOn(event.target.checked)}
                className="accent-violet-500"
              />
            </label>

            {/* BGM upload */}
            <div>
              <span className="mb-1.5 block text-[11px] text-(--color-ink-faint)">背景音乐（可选）</span>
              <input
                type="file"
                accept="audio/*"
                onChange={(event) => { const f = event.target.files?.[0]; if (f) void handleBgm(f); }}
                className="w-full text-[11px] text-(--color-ink-fainter) file:mr-2 file:rounded-lg file:border-0 file:bg-violet-500/20 file:px-3 file:py-1.5 file:text-[11px] file:text-violet-300"
              />
              {bgmName && <p className="mt-1 truncate text-[11px] text-violet-300">已选：{bgmName}</p>}
            </div>

            {/* Error display */}
            {film?.error && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] leading-relaxed text-rose-300">
                {film.error}
                {film.status === "FAILED" && film.shots.some((shot) => shot.status === "SUCCEEDED") && (
                  <button onClick={handleRecompose} className="ml-2 underline hover:no-underline">
                    重新合成
                  </button>
                )}
              </div>
            )}

            {/* FFmpeg warning */}
            {!ffmpegAvailable && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-300">
                未检测到 ffmpeg，逐镜视频仍可生成，但无法自动拼接成片。
              </p>
            )}
          </div>
        </aside>
      </div>

      {/* ── Status Bar ──────────────────────────────── */}
      <footer className="relative z-10 flex h-6 shrink-0 items-center justify-center gap-2 border-t border-white/4 bg-(--color-panel-deep)/95 backdrop-blur-sm">
        <span className="inline-block h-[7px] w-[7px] rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/40" />
        <span className="text-[11px] text-[#6b788f]">
          ComfyUI 本地已连接 · Wan I2V 视频模型就绪 · GPU 可用
        </span>
      </footer>
    </div>
  );
}
