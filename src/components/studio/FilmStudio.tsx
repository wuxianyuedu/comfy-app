"use client";

import { useCallback, useState } from "react";

import { AuroraGlow } from "~/components/ui/aurora-background";
import { ShotReviewDialog } from "~/components/agent-run/ShotReviewDialog";
import { useFilmStudio } from "./hooks/use-film-studio";
import { useToast } from "./ToastProvider";
import { MOCK_SHOTS, type ShotListItem } from "./film-studio-config";
import { FilmStudioTopBar } from "./FilmStudioTopBar";
import { FilmStudioShotListPanel } from "./FilmStudioShotListPanel";
import { FilmStudioPreviewPanel } from "./FilmStudioPreviewPanel";
import { FilmStudioTimeline } from "./FilmStudioTimeline";
import { FilmStudioPropertyPanel } from "./FilmStudioPropertyPanel";

/* ── 影片工坊 —— Updream 风视频剪辑器（对齐 Ardot） ─
 深色主题的**时间线**视频剪辑工坊。
 对齐 Ardot 设计规范：深色极光（#0a0a0f）+ 紫 #8B5CF6 强调。
 渲染在 WorkspaceNav 父壳内部（侧栏由外部提供）。

 布局（壳内）：
 ┌──────────────────────────────────────────────────────────┐
 │ 顶部工具栏：[项目名] [撤销|重做] … [▶] [导出成片] │
 ├──────────┬───────────────────────────────┬───────────────┤
 │ 镜头列表 │ 预览画布（16:9） │ 属性面板 │
 │ (260px) │ ┌─────────────────────┐ │ (280px) │
 │ · 镜头1 │ │ ▶ 播放覆盖层 │ │ 镜头名称 │
 │ · 镜头2 │ └─────────────────────┘ │ 时长 │
 │ · 镜头3 │ 时间线 │ 生成模式 │
 │ [+ 添加] │ 标尺 + 视频/字幕/BGM 轨道 │ 转场效果 │
 ├──────────┴───────────────────────────────┴───────────────┤ │ 提示词 │
 │ 状态栏：● ComfyUI 本地已连接 · GPU 可用 │
 └──────────────────────────────────────────────────────────┘
*/

/**
 * 成片工作室 —— 视图层（规范 17 §17.2 第③层）。
 * 成片流程、轮询与 BGM 上传在 hooks/use-film-studio.ts + lib/film/bgm-client.ts，
 * 常量与类型在 film-studio-config.ts。本文件只做渲染与上抛事件。
 * 对外导出名与组件签名保持不变，消费方（app/workspace/page.tsx）零改动。
 *
 * 视觉区域拆在同目录（本组件只持有时间轴编辑器的本地状态与组合）：
 * FilmStudioTopBar / FilmStudioShotListPanel / FilmStudioPreviewPanel /
 * FilmStudioTimeline / FilmStudioPropertyPanel。
 */
export function FilmStudio() {
  const { info } = useToast();
  const c = useFilmStudio();

  /* ── 时间轴编辑器状态：纯视觉、无网络副作用，故留在视图层 ── */
  const [shots, setShots] = useState<ShotListItem[]>(MOCK_SHOTS);
  const [selectedShotId, setSelectedShotId] = useState<string>("shot-1");
  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadPos] = useState(180); /* px from timeline left */
  /* 当前要评审的镜头（非空即打开评审弹窗）。评审走 AI 文本质检，不合格可抽卡 / 改提示词重生成。 */
  const [reviewShot, setReviewShot] = useState<ShotListItem | null>(null);

  const selectedShot =
    shots.find((shot) => shot.id === selectedShotId) ?? shots[0];
  /* 项目来源且该项目确有镜头 → 左栏显示真实镜头（缩略图/时长/状态）；否则维持样例时间轴。 */
  const isProjectSource =
    c.shotSource === "project" && c.projectShots.length > 0;
  const listShots = isProjectSource ? c.projectShots : shots;

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

  /* 属性面板对样例镜头字段的回写（名称 / 时长）。 */
  const patchShot = useCallback((id: string, patch: Partial<ShotListItem>) => {
    setShots((prev) =>
      prev.map((shot) => (shot.id === id ? { ...shot, ...patch } : shot)),
    );
  }, []);

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
      <FilmStudioTopBar
        c={c}
        isPlaying={isPlaying}
        onTogglePlay={handleTogglePlay}
        onUndo={handleUndo}
        onRedo={handleRedo}
      />

      {/* ── 三栏主体 ───────────────────────── */}
      <div className="z-base relative flex min-h-0 flex-1 overflow-hidden">
        {/* ═══ 左：镜头列表面板（260px） ═══ */}
        <FilmStudioShotListPanel
          c={c}
          listShots={listShots}
          selectedShotId={selectedShotId}
          isProjectSource={isProjectSource}
          onSelectShot={handleSelectShot}
          onAddShot={handleAddShot}
          onReviewShot={setReviewShot}
        />

        {/* ═══ 中：预览 + 时间线 ═══ */}
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden p-5 pb-3">
          <FilmStudioPreviewPanel
            c={c}
            isPlaying={isPlaying}
            onTogglePlay={handleTogglePlay}
          />
          <FilmStudioTimeline playheadPos={playheadPos} bgmName={c.bgmName} />
        </main>

        {/* ═══ 右：属性面板（280px） ═══ */}
        <FilmStudioPropertyPanel
          c={c}
          selectedShot={selectedShot!}
          selectedShotId={selectedShotId}
          onPatchShot={patchShot}
        />
      </div>

      {/* ── Status Bar ──────────────────────────────── */}
      <footer className="border-border-subtle bg-panel-deep/95 z-base relative flex h-6 shrink-0 items-center justify-center gap-2 border-t backdrop-blur-sm">
        <span className="bg-success shadow-success/40 inline-block size-1.75 rounded-full shadow-sm" />
        <span className="text-ink-muted text-2xs">
          ComfyUI 本地已连接 · Wan I2V 视频模型就绪 · GPU 可用
        </span>
      </footer>

      {/* AI 评审弹窗：镜头行「评审」按钮打开；重生成后刷新左栏镜头列表。 */}
      {reviewShot && c.activeProjectId && (
        <ShotReviewDialog
          open
          onOpenChange={(next) => {
            if (!next) setReviewShot(null);
          }}
          projectId={c.activeProjectId}
          shot={{ id: reviewShot.id, name: reviewShot.name }}
          onRegenerated={() => void c.reloadProjectShots()}
        />
      )}
    </div>
  );
}
