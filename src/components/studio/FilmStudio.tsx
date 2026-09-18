"use client";

import { useCallback, useState } from "react";
import { Redo2, Undo2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import { useFilmStudio } from "./hooks/use-film-studio";
import { AuroraGlow } from "~/components/ui/aurora-background";
import { useToast } from "./ToastProvider";
import { sizeSpecSummary } from "~/lib/media/size-presets";
import {
  MOCK_SHOTS,
  MODE_LABELS,
  STATUS_BADGE,
  STAGE_LABEL,
  VIDEO_CLIPS,
  formatShotDuration,
  type ShotListItem,
} from "./film-studio-config";

/* ── 影片工坊 —— Updream 风视频剪辑器（对齐 Ardot） ─
  深色主题的**时间线**视频剪辑工坊。
  对齐 Ardot 设计规范：深色极光（#0a0a0f）+ 紫 #8B5CF6 强调。
  渲染在 WorkspaceNav 父壳内部（侧栏由外部提供）。

  布局（壳内）：
  ┌──────────────────────────────────────────────────────────┐
  │ 顶部工具栏：[项目名] [撤销|重做] … [▶] [导出成片]  │
  ├──────────┬───────────────────────────────┬───────────────┤
  │ 镜头列表 │  预览画布（16:9）            │  属性面板     │
  │ (260px)  │  ┌─────────────────────┐     │  (280px)      │
  │          │  │    ▶ 播放覆盖层       │     │  镜头名称      │
  │ · 镜头1  │  └─────────────────────┘     │  时长          │
  │ · 镜头2  │                               │  生成模式      │
  │ · 镜头3  │  时间线                       │  转场效果      │
  │ [+ 添加] │  标尺 + 视频/字幕/BGM 轨道     │  提示词        │
  ├──────────┴───────────────────────────────┴───────────────┤
  │ 状态栏：● ComfyUI 本地已连接 · GPU 可用              │
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

  const selectedShot =
    shots.find((shot) => shot.id === selectedShotId) ?? shots[0];
  const running = c.running;

  const handleSelectShot = useCallback((id: string) => {
    setSelectedShotId(id);
    setShots((prev) =>
      prev.map((prev) => ({ ...prev, selected: prev.id === id })),
    );
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
    setShots((prev) => [
      ...prev.map((prev) => ({ ...prev, selected: false })),
      newShot,
    ]);
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
    <div
      className="bg-canvas flex h-full w-full flex-col overflow-hidden"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      {/* ── 极光背景光斑 ───────────────── */}
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden
      >
        <AuroraGlow
          tone="violet"
          alpha={0.42}
          className="top-[-20%] right-[-10%] h-[70%] w-[55%] opacity-10 mix-blend-normal dark:opacity-50 dark:mix-blend-screen"
        />
        <AuroraGlow
          tone="cyan"
          alpha={0.28}
          className="bottom-[15%] left-[-15%] h-[55%] w-[45%] opacity-10 mix-blend-normal dark:opacity-50 dark:mix-blend-screen"
        />
      </div>

      {/* ── Top Toolbar ─────────────────────────────── */}
      <header className="border-border-subtle bg-panel/88 relative z-10 flex shrink-0 items-center gap-3 border-b px-4 py-0 backdrop-blur-md">
        {/* Project name */}
        <div className="flex items-center gap-2">
          <span className="u-title">{c.title}</span>
          <span className="text-ink-fainter text-xs">· 视频成片工作室</span>
        </div>

        <div className="bg-surface-2 h-5 w-px" />

        {/* Undo / Redo */}
        <Button
          variant="ghost"
          size="icon"
          onClick={handleUndo}
          className="text-ink-muted hover:bg-subtle hover:text-ink-strong rounded-lg"
          title="撤销"
        >
          <Undo2 size={16} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleRedo}
          className="text-ink-muted hover:bg-subtle hover:text-ink-strong rounded-lg"
          title="重做"
        >
          <Redo2 size={16} />
        </Button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Play button */}
        <Button
          variant="primary-solid"
          size="icon-lg"
          onClick={handleTogglePlay}
          className="rounded-xl shadow-sm hover:scale-[1.03]"
          title={isPlaying ? "暂停" : "播放预览"}
        >
          {isPlaying ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </Button>

        <div className="w-3" />

        {/* 缩放标签 + 导出 */}
        <span className="text-ink-faintest text-[11px]">时间轴缩放</span>
        <Button
          variant="primary"
          size="sm"
          onClick={() => void c.create()}
          disabled={c.loading || !c.videoWorkflowId}
          className="bg-subtle h-auto gap-1.5 rounded-lg px-3.5 py-1.5 font-semibold"
        >
          {c.loading ? "启动中…" : "导出成片"}
        </Button>

        {/* 取消按钮（运行中时） */}
        {c.film && running && (
          <Button
            variant="outline"
            size="xs"
            onClick={() => void c.cancel()}
            className="border-border text-ink-strong hover:bg-surface-2 h-auto rounded-lg px-3 py-1.5"
          >
            取消
          </Button>
        )}
      </header>

      {/* ── 三栏主体 ───────────────────────── */}
      <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden">
        {/* ═══ 左：镜头列表面板（260px） ═══ */}
        <aside className="border-border-subtle bg-panel-deep/85 flex w-[260px] shrink-0 flex-col border-r backdrop-blur-sm">
          {/* Header */}
          <div className="border-border-subtle flex h-11 items-center justify-between border-b px-4">
            <div className="flex items-center gap-2">
              <span className="text-ink-field text-[13px] font-semibold">
                分镜列表
              </span>
              <span className="text-ink-fainter text-[11px]">
                {shots.length} 镜头
              </span>
            </div>
            <Button
              variant="primary"
              size="icon-xs"
              onClick={handleAddShot}
              className="rounded-md"
              title="新增镜头"
            >
              +
            </Button>
          </div>

          {/* Shot items */}
          <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
            {shots.map((shot) => {
              const badge = STATUS_BADGE[shot.status];
              const isSelected = shot.id === selectedShotId;
              return (
                <Button
                  key={shot.id}
                  variant="ghost"
                  onClick={() => handleSelectShot(shot.id)}
                  className={`group flex h-auto w-full items-center gap-3 rounded-xl border p-2.5 text-left font-normal transition-all ${
                    isSelected
                      ? "border-primary-500/40 bg-primary-500/12 shadow-sm shadow-black/5 dark:shadow-black/10"
                      : "bg-card hover:border-border hover:bg-subtle border-transparent"
                  }`}
                >
                  {/* Thumbnail placeholder */}
                  <div
                    className={`flex h-12 w-[56px] shrink-0 items-center justify-center rounded-md text-[10px] ${
                      isSelected
                        ? "bg-violet-500/10 text-violet-700 dark:text-violet-400"
                        : "bg-subtle text-ink-faintest"
                    }`}
                  >
                    镜头缩略图
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <p
                      className={`truncate text-[12px] font-medium ${isSelected ? "text-ink-field" : "text-ink-strong"}`}
                    >
                      {shot.name}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-ink-faintest text-[10px]">
                        {shot.duration}
                      </span>
                      <span className="text-ink-faintest text-[10px]">·</span>
                      <span className="text-ink-fainter text-[10px]">
                        {MODE_LABELS[shot.mode]}
                      </span>
                    </div>
                  </div>

                  {/* Status badge */}
                  <span
                    className={`shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-medium ${badge.bg} ${badge.text}`}
                  >
                    {badge.label}
                  </span>
                </Button>
              );
            })}
          </div>
        </aside>

        {/* ═══ 中：预览 + 时间线 ═══ */}
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden p-5 pb-3">
          {/* Preview Canvas */}
          <div className="border-border-subtle bg-canvas-deep relative mb-3 flex min-h-[320px] flex-1 items-center justify-center overflow-hidden rounded-2xl border">
            {/* Resolution hint：写尺寸表达（比例 + 档位），与全项目的尺寸口径一致。 */}
            <span className="text-ink-faintest bg-canvas-deep absolute top-2.5 left-3 rounded px-2 py-0.5 font-mono text-[10px] backdrop-blur-sm">
              {sizeSpecSummary(c.size)} · {c.fps}fps
            </span>

            {/* Play overlay */}
            <Button
              variant="ghost"
              onClick={handleTogglePlay}
              className="border-border-strong flex size-16 items-center justify-center rounded-full border bg-black/45 shadow-lg shadow-black/6 transition-all hover:scale-105 hover:bg-black/55 active:scale-95 dark:shadow-black/30"
              title={isPlaying ? "暂停" : "播放"}
            >
              {isPlaying ? (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="#fff">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="#fff">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </Button>

            {/* 影片进度覆盖层（生成中） */}
            {c.film && running && (
              <div className="absolute right-0 bottom-0 left-0 bg-black/60 px-4 py-2.5 backdrop-blur-sm">
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="text-ink-bright font-medium">
                    {STAGE_LABEL[c.film.status]}
                  </span>
                  <span className="text-ink-faint">{c.film.progress}%</span>
                </div>
                <div className="bg-surface-2 h-1.5 w-full overflow-hidden rounded-full">
                  <div
                    className="h-full rounded-full bg-linear-to-r from-violet-500 to-fuchsia-500 transition-all"
                    style={{ width: `${c.film.progress}%` }}
                  />
                </div>
              </div>
            )}

            {/* 成片播放器（完成后） */}
            {c.film?.status === "DONE" && c.film.finalVideo && (
              <video
                src={c.film.finalVideo}
                controls
                autoPlay
                className="absolute inset-0 h-full w-full bg-black object-contain"
              />
            )}
          </div>

          {/* Timeline */}
          <div className="border-border-subtle bg-panel-deep/90 mt-auto rounded-xl border p-3 backdrop-blur-sm">
            {/* Time ruler */}
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-ink-faintest font-mono text-[10px]">
                00:00
              </span>
              <span className="text-ink-faintest font-mono text-[10px]">
                00:05
              </span>
              <span className="text-ink-faintest font-mono text-[10px]">
                00:10
              </span>
            </div>

            {/* Tracks container */}
            <div className="relative space-y-1">
              {/* Playhead */}
              <div
                className="pointer-events-none absolute bottom-0 z-10 w-[2px] bg-red-400/80"
                style={{
                  left: `${Math.min(playheadPos, 600)}px`,
                  top: 0,
                  height: "100%",
                }}
              >
                <div className="absolute -top-1 left-[-7px] h-[10px] w-4 rounded-sm bg-red-400/80" />
              </div>

              {/* Video track */}
              <div className="bg-subtle flex h-11 items-center gap-2 rounded-md px-2">
                <span className="text-ink-faint w-12 shrink-0 text-[10px]">
                  视频轨
                </span>
                <div className="flex flex-1 gap-1.5">
                  {VIDEO_CLIPS.map((clip) => (
                    <div
                      key={clip.id}
                      className={`flex h-8 items-center rounded-md bg-linear-to-r ${clip.colorClass} px-2.5 shadow-sm`}
                      style={{ width: `${clip.width}px` }}
                    >
                      <span
                        className={`text-[10px] font-semibold ${clip.textColorClass}`}
                      >
                        {clip.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Subtitle track */}
              <div className="flex h-9 items-center gap-2 rounded-md px-2">
                <span className="text-ink-fainter w-12 shrink-0 text-[10px]">
                  字幕轨
                </span>
                <div
                  className="flex h-6 flex-1 items-center rounded bg-emerald-400/15 px-2.5 ring-1 ring-emerald-400/25 ring-inset"
                  style={{ width: "280px" }}
                >
                  <span className="truncate text-[9px] text-cyan-700 dark:text-cyan-400">
                    「城市在晨光中苏醒，镜头缓缓推进…」
                  </span>
                </div>
              </div>

              {/* BGM / 音轨 */}
              <div className="flex h-9 items-center gap-2 rounded-md px-2">
                <span className="text-ink-fainter w-12 shrink-0 text-[10px]">
                  BGM
                </span>
                <div
                  className="flex h-6 flex-1 items-center rounded bg-linear-to-r from-blue-500/20 to-violet-500/20 px-2.5"
                  style={{ width: "200px" }}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#a78bfa"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="mr-1.5 shrink-0"
                  >
                    <path d="M9 18V5l12-2v13M9 18a3 3 0 01-3-3H3a3 3 0 006 3z" />
                  </svg>
                  <span className="truncate text-[9px] text-violet-700 dark:text-violet-400">
                    {c.bgmName ?? "背景音乐 · 氛围感配乐"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </main>

        {/* ═══ 右：属性面板（280px） ═══ */}
        <aside className="border-border-subtle bg-panel-deep/85 flex w-[280px] shrink-0 flex-col border-l backdrop-blur-sm">
          {/* Header */}
          <div className="border-border-subtle flex h-11 items-center border-b px-4">
            <span className="text-ink-field text-[13px] font-semibold">
              镜头属性
            </span>
          </div>

          {/* Form fields */}
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {/* Shot name */}
            <label className="block">
              <span className="text-ink-faint mb-1.5 block text-[11px]">
                镜头名称
              </span>
              <input
                value={selectedShot!.name}
                onChange={(event) =>
                  setShots((prev) =>
                    prev.map((prev) =>
                      prev.id === selectedShotId
                        ? { ...prev, name: event.target.value }
                        : prev,
                    ),
                  )
                }
                className="border-border bg-subtle text-ink-field h-9 w-full rounded-lg border px-3 text-[13px] outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20"
              />
            </label>

            {/* Duration */}
            <label className="block">
              <span className="text-ink-faint mb-1.5 block text-[11px]">
                时长 (秒)
              </span>
              <input
                type="number"
                step="0.1"
                min="0.5"
                max="30"
                value={parseFloat(selectedShot!.duration)}
                onChange={(event) =>
                  setShots((prev) =>
                    prev.map((prev) =>
                      prev.id === selectedShotId
                        ? {
                            ...prev,
                            duration: formatShotDuration(
                              Number(event.target.value),
                            ),
                          }
                        : prev,
                    ),
                  )
                }
                className="border-border bg-subtle text-ink-field h-9 w-full rounded-lg border px-3 text-[13px] outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20"
              />
            </label>

            {/* Mode select */}
            <label className="block">
              <span className="text-ink-faint mb-1.5 block text-[11px]">
                生成模式
              </span>
              <div className="border-border bg-subtle text-ink-field flex h-9 items-center rounded-lg border px-3 text-[13px]">
                图生视频 (Wan I2V)
              </div>
            </label>

            {/* Transition */}
            <label className="block">
              <span className="text-ink-faint mb-1.5 block text-[11px]">
                转场效果
              </span>
              <div className="border-border bg-subtle text-ink-strong flex h-9 items-center rounded-lg border px-3 text-[13px]">
                溶解过渡 (Cross Dissolve)
              </div>
            </label>

            {/* Prompt textarea */}
            <label className="block">
              <span className="text-ink-faint mb-1.5 block text-[11px]">
                提示词 / 描述
              </span>
              <textarea
                rows={3}
                defaultValue="城市在晨光中苏醒，镜头缓缓推进，展现繁忙街道与远处天际线…"
                className="border-border bg-subtle text-ink-fainter w-full resize-none rounded-lg border px-3 py-2 text-[12px] leading-relaxed outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20"
              />
            </label>

            {/* Divider */}
            <hr className="border-border-subtle" />

            {/* 全局配置：剧本输入（从原版收起） */}
            <label className="block">
              <span className="text-ink-faint mb-1.5 block text-[11px]">
                剧本 / 创意
              </span>
              <textarea
                value={c.script}
                onChange={(event) => c.setScript(event.target.value)}
                rows={3}
                placeholder="支持一句话自动分镜…"
                className="border-border bg-subtle text-ink-fainter placeholder:text-ink-faintest w-full resize-none rounded-lg border px-3 py-2 text-[12px] leading-relaxed outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20"
              />
            </label>

            {/* 逐镜生成用的工作流（内置模板已移除，必须从工作流库选） */}
            <label className="block">
              <span className="text-ink-faint mb-1.5 block text-[11px]">
                视频工作流（工作流库）
              </span>
              <select
                value={c.videoWorkflowId}
                onChange={(event) => c.setVideoWorkflowId(event.target.value)}
                className="border-border bg-subtle text-ink-field h-9 w-full rounded-lg border px-3 text-[13px] outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20"
              >
                <option value="">
                  {c.videoWorkflows.length
                    ? "选择视频工作流…"
                    : "工作流库里还没有视频工作流"}
                </option>
                {c.videoWorkflows.map((wf) => (
                  <option key={wf.id} value={wf.id}>
                    {wf.name}
                  </option>
                ))}
              </select>
              {!c.videoWorkflowId && (
                <span className="text-ink-fainter mt-1 block text-[10.5px]">
                  没有内置视频工作流可回落 ——
                  请先在工作室「工作流库」导入并配好对外参数。
                </span>
              )}
            </label>

            {/* 文生视频镜头合成首帧用的图类工作流（镜头自带首帧时不需要） */}
            <label className="block">
              <span className="text-ink-faint mb-1.5 block text-[11px]">
                首帧合成工作流（可选，工作流库）
              </span>
              <select
                value={c.imageWorkflowId}
                onChange={(event) => c.setImageWorkflowId(event.target.value)}
                className="border-border bg-subtle text-ink-field h-9 w-full rounded-lg border px-3 text-[13px] outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20"
              >
                <option value="">
                  {c.imageWorkflows.length
                    ? "不需要 / 未选择"
                    : "工作流库里还没有图类工作流"}
                </option>
                {c.imageWorkflows.map((wf) => (
                  <option key={wf.id} value={wf.id}>
                    {wf.name}
                  </option>
                ))}
              </select>
            </label>

            {/* Subtitle toggle */}
            <label className="border-border bg-canvas/60 flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2.5">
              <span className="text-ink-field text-sm">烧录字幕</span>
              <input
                type="checkbox"
                checked={c.subtitleOn}
                onChange={(event) => c.setSubtitleOn(event.target.checked)}
                className="accent-violet-500"
              />
            </label>

            {/* BGM upload */}
            <div>
              <span className="text-ink-faint mb-1.5 block text-[11px]">
                背景音乐（可选）
              </span>
              <input
                type="file"
                accept="audio/*"
                onChange={(event) => {
                  const f = event.target.files?.[0];
                  if (f) void c.uploadBgmFile(f);
                }}
                className="text-ink-fainter w-full text-[11px] file:mr-2 file:rounded-lg file:border-0 file:bg-violet-500/20 file:px-3 file:py-1.5 file:text-[11px] file:text-violet-800 dark:text-violet-300 dark:file:text-violet-300"
              />
              {c.bgmName && (
                <p className="mt-1 truncate text-[11px] text-violet-700 dark:text-violet-400">
                  已选：{c.bgmName}
                </p>
              )}
            </div>

            {/* Error display */}
            {c.film?.error && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] leading-relaxed text-rose-700 dark:text-rose-400">
                {c.film.error}
                {c.film.status === "FAILED" &&
                  c.film.shots.some((shot) => shot.status === "SUCCEEDED") && (
                    <Button
                      variant="link"
                      onClick={() => void c.recompose()}
                      className="ml-2 h-auto text-inherit underline hover:no-underline"
                    >
                      重新合成
                    </Button>
                  )}
              </div>
            )}

            {/* FFmpeg warning */}
            {!c.ffmpegAvailable && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                未检测到 ffmpeg，逐镜视频仍可生成，但无法自动拼接成片。
              </p>
            )}
          </div>
        </aside>
      </div>

      {/* ── Status Bar ──────────────────────────────── */}
      <footer className="border-border-subtle bg-panel-deep/95 relative z-10 flex h-6 shrink-0 items-center justify-center gap-2 border-t backdrop-blur-sm">
        <span className="inline-block h-[7px] w-[7px] rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/40" />
        <span className="text-ink-muted text-[11px]">
          ComfyUI 本地已连接 · Wan I2V 视频模型就绪 · GPU 可用
        </span>
      </footer>
    </div>
  );
}
