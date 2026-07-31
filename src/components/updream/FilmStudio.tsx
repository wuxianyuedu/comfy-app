"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { MediaThumb } from "./MediaThumb";
import { useToast } from "./Toast";

type FilmStatus = "PARSING" | "GENERATING" | "COMPOSING" | "DONE" | "FAILED" | "CANCELLED";
type ShotStatus = "IDLE" | "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";

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

const TYPE_LABELS: Record<string, string> = {
  short_video: "短视频",
  micro_film: "微电影",
  ad: "广告",
  other: "其他",
};
const SIZES = ["1280x720", "1920x1080", "832x480", "1024x576", "768x768"];
const STAGE_LABEL: Record<FilmStatus, string> = {
  PARSING: "分镜解析中",
  GENERATING: "逐镜生成视频中",
  COMPOSING: "合成完整影片中",
  DONE: "影片已完成",
  FAILED: "生成失败",
  CANCELLED: "已取消",
};

export function FilmStudio() {
  const { success, error, info } = useToast();
  const [title, setTitle] = useState("未命名影片");
  const [script, setScript] = useState(
    "清晨，老咖啡馆里，一位老人正在擦拭相框。阳光斜照进来，他想起年轻时的约定。门外，一个熟悉的身影出现……"
  );
  const [type, setType] = useState("short_video");
  const [styleSlug, setStyleSlug] = useState("");
  const [size, setSize] = useState("1280x720");
  const [fps, setFps] = useState(16);
  const [frames, setFrames] = useState(49);
  const [subtitleOn, setSubtitleOn] = useState(true);
  const [bgmName, setBgmName] = useState<string | null>(null);
  const [skills, setSkills] = useState<{ slug: string; name: string }[]>([]);
  const [ffmpegAvailable, setFfmpegAvailable] = useState(true);

  const [film, setFilm] = useState<Film | null>(null);
  const [recent, setRecent] = useState<{ id: string; title: string; status: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── load skills + recent films + ffmpeg flag ──
  const refreshMeta = useCallback(async () => {
    try {
      const [sRes, fRes] = await Promise.all([fetch("/api/skills"), fetch("/api/film")]);
      const sData = await sRes.json();
      const list = sData.skills ?? sData ?? [];
      setSkills(list.map((s: any) => ({ slug: s.slug, name: s.name })));
      const fData = await fRes.json();
      setFfmpegAvailable(!!fData.ffmpegAvailable);
      setRecent(fData.films ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refreshMeta();
  }, [refreshMeta]);

  // ── polling ──
  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const fetchDetail = useCallback(async (id: string) => {
    const res = await fetch(`/api/film/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    const f: Film = data.film;
    setFilm(f);
    if (f.status === "GENERATING" || f.status === "COMPOSING" || f.status === "PARSING") {
      if (!pollRef.current) {
        pollRef.current = setInterval(() => void fetchDetail(id), 3000);
      }
    } else {
      stopPoll();
    }
  }, [stopPoll]);

  useEffect(() => () => stopPoll(), [stopPoll]);

  // ── one-click create + start ──
  const handleCreate = useCallback(async () => {
    if (!script.trim()) {
      error("请先输入剧本或创意");
      return;
    }
    setLoading(true);
    try {
      stopPoll();
      const createRes = await fetch("/api/film", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          script,
          type,
          styleSlug: styleSlug || null,
          size,
          fps,
          framesPerShot: frames,
          subtitleOn,
          bgmName,
        }),
      });
      if (!createRes.ok) {
        const e = await createRes.json().catch(() => ({}));
        throw new Error(e.error ?? "创建失败");
      }
      const { id } = await createRes.json();
      const startRes = await fetch(`/api/film/${id}/start`, { method: "POST" });
      if (!startRes.ok) {
        const e = await startRes.json().catch(() => ({}));
        throw new Error(e.error ?? "启动失败");
      }
      await fetchDetail(id);
      success("已启动一键成片，正在逐镜生成…");
    } catch (e: any) {
      error(e?.message ?? "启动失败");
    } finally {
      setLoading(false);
    }
  }, [script, title, type, styleSlug, size, fps, frames, subtitleOn, bgmName, stopPoll, fetchDetail, error]);

  const handleCancel = useCallback(async () => {
    if (!film) return;
    await fetch(`/api/film/${film.id}/cancel`, { method: "POST" });
    stopPoll();
    await fetchDetail(film.id);
    info("已取消");
  }, [film, stopPoll, fetchDetail, info]);

  const handleRecompose = useCallback(async () => {
    if (!film) return;
    setLoading(true);
    try {
      await fetch(`/api/film/${film.id}/compose`, { method: "POST" });
      await fetchDetail(film.id);
    } finally {
      setLoading(false);
    }
  }, [film, fetchDetail]);

  const handleBgm = useCallback(async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/film/bgm", { method: "POST", body: form });
    if (!res.ok) {
      error("BGM 上传失败");
      return;
    }
    const { name } = await res.json();
    setBgmName(name);
    success("背景音乐已上传");
  }, [error, success]);

  const openRecent = useCallback(
    async (id: string) => {
      stopPoll();
      await fetchDetail(id);
    },
    [stopPoll, fetchDetail]
  );

  const running = film && (film.status === "GENERATING" || film.status === "COMPOSING" || film.status === "PARSING");

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#0a0a0f]">
      {/* header */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🎬</span>
          <h1 className="text-sm font-semibold text-gray-100">一键成片 · Film Studio</h1>
          <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-gray-400">实验</span>
        </div>
        {film && running && (
          <button
            onClick={handleCancel}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-white/[0.06]"
          >
            取消
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* config panel */}
        <div className="w-[320px] shrink-0 overflow-y-auto border-r border-white/[0.06] p-4">
          <label className="mb-1 block text-[11px] text-gray-400">影片标题</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mb-3 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-100 outline-none focus:border-violet-500/60"
          />

          <label className="mb-1 block text-[11px] text-gray-400">剧本 / 创意（支持一句话自动分镜）</label>
          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            rows={6}
            placeholder="例如：清晨的咖啡馆，老人擦拭相框，回忆年轻时与友人的约定……"
            className="mb-3 w-full resize-none rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-100 outline-none focus:border-violet-500/60"
          />

          <div className="mb-3 grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[11px] text-gray-400">类型</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-2 py-2 text-sm text-gray-100 outline-none"
              >
                {Object.entries(TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-gray-400">风格</label>
              <select
                value={styleSlug}
                onChange={(e) => setStyleSlug(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-2 py-2 text-sm text-gray-100 outline-none"
              >
                <option value="">无（默认）</option>
                {skills.map((s) => (
                  <option key={s.slug} value={s.slug}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mb-3 grid grid-cols-3 gap-2">
            <div>
              <label className="mb-1 block text-[11px] text-gray-400">分辨率</label>
              <select
                value={size}
                onChange={(e) => setSize(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-2 py-2 text-xs text-gray-100 outline-none"
              >
                {SIZES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-gray-400">帧率</label>
              <input
                type="number"
                min={8}
                max={30}
                value={fps}
                onChange={(e) => setFps(Number(e.target.value))}
                className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-2 py-2 text-xs text-gray-100 outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-gray-400">每镜帧数</label>
              <input
                type="number"
                min={17}
                max={241}
                value={frames}
                onChange={(e) => setFrames(Number(e.target.value))}
                className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-2 py-2 text-xs text-gray-100 outline-none"
              />
            </div>
          </div>

          <label className="mb-3 flex cursor-pointer items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
            <span className="text-sm text-gray-200">烧录字幕</span>
            <input type="checkbox" checked={subtitleOn} onChange={(e) => setSubtitleOn(e.target.checked)} className="accent-violet-500" />
          </label>

          <div className="mb-4">
            <label className="mb-1 block text-[11px] text-gray-400">背景音乐（可选）</label>
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleBgm(f);
              }}
              className="w-full text-xs text-gray-400 file:mr-2 file:rounded-lg file:border-0 file:bg-violet-500/20 file:px-3 file:py-1 file:text-violet-200"
            />
            {bgmName && <p className="mt-1 truncate text-[11px] text-violet-300">已选：{bgmName}</p>}
          </div>

          <button
            onClick={handleCreate}
            disabled={loading}
            className="w-full rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition-transform hover:scale-[1.02] disabled:opacity-60"
          >
            {loading ? "启动中…" : "🎬 一键成片"}
          </button>

          {!ffmpegAvailable && (
            <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-300">
              未检测到 ffmpeg，逐镜视频仍可生成，但无法自动拼接成片。请在系统安装 ffmpeg 并设置环境变量
              <code className="mx-1 rounded bg-black/30 px-1">FFMPEG_BIN</code>，之后点「重新合成」。
            </p>
          )}

          {recent.length > 0 && (
            <div className="mt-5">
              <p className="mb-2 text-[11px] text-gray-500">历史影片</p>
              <div className="space-y-1">
                {recent.slice(0, 6).map((r) => (
                  <button
                    key={r.id}
                    onClick={() => openRecent(r.id)}
                    className="flex w-full items-center justify-between rounded-lg border border-white/[0.06] px-3 py-2 text-left text-xs text-gray-300 transition-colors hover:bg-white/[0.05]"
                  >
                    <span className="truncate">{r.title}</span>
                    <span className="ml-2 shrink-0 text-[10px] text-gray-500">{r.status}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* stage + shot board */}
        <div className="min-w-0 flex-1 overflow-y-auto p-6">
          {!film && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-500/10 text-3xl">🎬</div>
              <p className="mb-1 text-lg font-medium text-gray-200">一句话，生成完整影片</p>
              <p className="max-w-md text-sm text-gray-500">
                输入剧本或创意 → 自动分镜 → 逐镜生成视频 → 一键合成完整成片（含字幕与可选 BGM）。
              </p>
            </div>
          )}

          {film && (
            <div className="mx-auto max-w-4xl">
              {/* final video */}
              {film.status === "DONE" && film.finalVideo && (
                <div className="mb-6 overflow-hidden rounded-2xl border border-white/10 bg-black">
                  <video src={film.finalVideo} controls className="aspect-video w-full bg-black" />
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm font-medium text-gray-100">{film.title} · 已完成</span>
                    <a
                      href={film.finalVideo}
                      download
                      className="rounded-lg bg-violet-500/90 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet-500"
                    >
                      下载影片
                    </a>
                  </div>
                </div>
              )}

              {/* stage */}
              <div className="mb-4">
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-200">{STAGE_LABEL[film.status]}</span>
                  <span className="text-gray-400">{film.progress}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all"
                    style={{ width: `${film.progress}%` }}
                  />
                </div>
                {film.error && (
                  <p className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                    {film.error}
                    {film.status === "FAILED" && film.shots.some((s) => s.status === "SUCCEEDED") && (
                      <button onClick={handleRecompose} className="ml-2 underline hover:no-underline">
                        重新合成
                      </button>
                    )}
                  </p>
                )}
              </div>

              {/* shot board */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {film.shots.map((s) => (
                  <div key={s.id} className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]">
                    <div className="aspect-video bg-black/40">
                      {s.videoPath ? (
                        <MediaThumb src={s.videoPath} className="h-full w-full" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-2xl text-gray-600">
                          {s.status === "RUNNING" ? "⏳" : s.status === "QUEUED" ? "📋" : s.status === "FAILED" ? "✗" : "🎞"}
                        </div>
                      )}
                    </div>
                    <div className="p-2.5">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-[11px] font-medium text-gray-300">
                          镜头 {s.order + 1}
                          {s.heading ? ` · ${s.heading}` : ""}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[9px] ${
                            s.status === "SUCCEEDED"
                              ? "bg-emerald-500/15 text-emerald-300"
                              : s.status === "FAILED"
                              ? "bg-rose-500/15 text-rose-300"
                              : s.status === "RUNNING"
                              ? "bg-violet-500/15 text-violet-300"
                              : "bg-white/10 text-gray-400"
                          }`}
                        >
                          {s.status}
                        </span>
                      </div>
                      <p className="line-clamp-2 text-[10px] leading-snug text-gray-500">{s.prompt}</p>
                      {(s.status === "RUNNING" || s.status === "QUEUED") && (
                        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
                          <div className="h-full bg-violet-500/70" style={{ width: `${s.progress}%` }} />
                        </div>
                      )}
                      {s.videoPath && (
                        <a
                          href={s.videoPath}
                          download
                          className="mt-2 inline-block text-[10px] text-violet-300 hover:underline"
                        >
                          下载片段
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* logs */}
              <div className="mt-5">
                <button
                  onClick={() => setShowLogs((v) => !v)}
                  className="text-xs text-gray-500 hover:text-gray-300"
                >
                  {showLogs ? "▾ 隐藏日志" : "▸ 查看日志"}
                </button>
                {showLogs && film.logs && (
                  <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-white/[0.06] bg-black/30 p-3 font-mono text-[11px] leading-relaxed">
                    {film.logs.map((l, i) => (
                      <div key={i} className="text-gray-400">
                        <span className="text-gray-600">
                          {new Date(l.t).toLocaleTimeString()}
                        </span>{" "}
                        <span
                          className={
                            l.level === "error"
                              ? "text-rose-400"
                              : l.level === "success"
                              ? "text-emerald-400"
                              : l.level === "warn"
                              ? "text-amber-400"
                              : "text-gray-300"
                          }
                        >
                          {l.msg}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
