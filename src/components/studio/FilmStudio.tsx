"use client";

import { useCallback, useState } from "react";
import { Redo2, Undo2 } from "lucide-react";

import { useFilmStudio } from "./hooks/use-film-studio";
import { useToast } from "./ToastProvider";
import {
  MOCK_SHOTS,
  MODE_LABELS,
  STATUS_BADGE,
  STAGE_LABEL,
  VIDEO_CLIPS,
  formatShotDuration,
  type ShotListItem,
} from "./film-studio-config";

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

/**
 * 成片工作室 —— 视图层（规范 17 §17.2 第③层）。
 * 成片流程、轮询与 BGM 上传在 hooks/use-film-studio.ts + lib/film/bgm-client.ts，
 * 常量与类型在 film-studio-config.ts。本文件只做渲染与上抛事件。
 * 对外导出名与组件签名保持不变，消费方（app/workspace/page.tsx）零改动。
 */
export function FilmStudio() {
  const { info } = useToast();
  const c = useFilmStudio();

  /* ── 时间轴编辑器状态：纯视觉、无网络副作用，故留在视图层 ── */
  const [shots, setShots] = useState<ShotListItem[]>(MOCK_SHOTS);
  const [selectedShotId, setSelectedShotId] = useState<string>("shot-1");
  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadPos] = useState(180); /* px from timeline left */

  const selectedShot = shots.find((shot) => shot.id === selectedShotId) ?? shots[0];
  const running = c.running;

  const handleSelectShot = useCallback((id: string) => {
    setSelectedShotId(id);
    setShots((prev) => prev.map((prev) => ({ ...prev, selected: prev.id === id })));
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
    setShots((prev) => [...prev.map((prev) => ({ ...prev, selected: false })), newShot]);
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
          <span className="u-title">{c.title}</span>
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
          onClick={() => void c.create()}
          disabled={c.loading}
          className="flex items-center gap-1.5 rounded-lg border border-violet-500/35 bg-white/3 px-3.5 py-1.5 text-xs font-semibold text-[#c4b5fd] transition-all hover:border-violet-500/55 hover:bg-violet-500/8 disabled:opacity-50"
        >
          {c.loading ? "启动中…" : "导出成片"}
        </button>

        {/* Cancel button (when running) */}
        {c.film && running && (
          <button
            onClick={() => void c.cancel()}
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
              {c.size} · {c.fps}fps
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
            {c.film && running && (
              <div className="absolute bottom-0 left-0 right-0 bg-black/60 backdrop-blur-sm px-4 py-2.5">
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-gray-200">{STAGE_LABEL[c.film.status]}</span>
                  <span className="text-gray-400">{c.film.progress}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/8">
                  <div
                    className="h-full rounded-full bg-linear-to-r from-violet-500 to-fuchsia-500 transition-all"
                    style={{ width: `${c.film.progress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Final video player (when done) */}
            {c.film?.status === "DONE" && c.film.finalVideo && (
              <video
                src={c.film.finalVideo}
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
                  <span className="truncate text-[9px] text-[#a78bfa]">{c.bgmName ?? "背景音乐 · 氛围感配乐"}</span>
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
                onChange={(event) => setShots((prev) => prev.map((prev) =>prev.id === selectedShotId ? { ...prev, duration: formatShotDuration(Number(event.target.value)) } : prev))}
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
                value={c.script}
                onChange={(event) => c.setScript(event.target.value)}
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
                checked={c.subtitleOn}
                onChange={(event) => c.setSubtitleOn(event.target.checked)}
                className="accent-violet-500"
              />
            </label>

            {/* BGM upload */}
            <div>
              <span className="mb-1.5 block text-[11px] text-(--color-ink-faint)">背景音乐（可选）</span>
              <input
                type="file"
                accept="audio/*"
                onChange={(event) => { const f = event.target.files?.[0]; if (f) void c.uploadBgmFile(f); }}
                className="w-full text-[11px] text-(--color-ink-fainter) file:mr-2 file:rounded-lg file:border-0 file:bg-violet-500/20 file:px-3 file:py-1.5 file:text-[11px] file:text-violet-300"
              />
              {c.bgmName && <p className="mt-1 truncate text-[11px] text-violet-300">已选：{c.bgmName}</p>}
            </div>

            {/* Error display */}
            {c.film?.error && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] leading-relaxed text-rose-300">
                {c.film.error}
                {c.film.status === "FAILED" && c.film.shots.some((shot) => shot.status === "SUCCEEDED") && (
                  <button onClick={() => void c.recompose()} className="ml-2 underline hover:no-underline">
                    重新合成
                  </button>
                )}
              </div>
            )}

            {/* FFmpeg warning */}
            {!c.ffmpegAvailable && (
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
