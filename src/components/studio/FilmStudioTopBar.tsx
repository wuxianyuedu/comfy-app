"use client";
/* 影片工坊顶部工具栏 —— 项目名 / 撤销重做 / 播放 / 导出成片 / 取消。 */
import { Redo2, Undo2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";
import type { FilmStudioController } from "./hooks/use-film-studio";

type FilmStudioTopBarProps = {
  c: FilmStudioController;
  isPlaying: boolean;
  onRedo: () => void;
  onTogglePlay: () => void;
  onUndo: () => void;
};

export function FilmStudioTopBar({
  c,
  isPlaying,
  onTogglePlay,
  onUndo,
  onRedo,
}: FilmStudioTopBarProps) {
  return (
    <header className="border-border-subtle bg-panel z-base relative flex shrink-0 items-center gap-3 border-b px-4 py-0">
      {/* 项目名 —— 它本身就是这一屏的标题。此前右侧还挂一个「· 视频成片工作室」：
          与侧栏 / 页签那一项（`NAV_ITEMS` 的 `film` → 「成片」）指同一件事，
          只是换了套说法，既挤宽度又没多给信息（ISSUE #1423）。 */}
      <h1 className="font-title u-title-page min-w-0 truncate">{c.title}</h1>

      <div className="bg-surface-2 h-5 w-px" />

      {/* Undo / Redo */}
      <Hint accessibleName label="撤销">
        <Button
          className="text-ink-muted hover:bg-subtle hover:text-ink-strong rounded-lg"
          onClick={onUndo}
          size="icon"
          variant="ghost"
        >
          <Undo2 data-icon="inline-start" size={16} />
        </Button>
      </Hint>
      <Hint accessibleName label="重做">
        <Button
          className="text-ink-muted hover:bg-subtle hover:text-ink-strong rounded-lg"
          onClick={onRedo}
          size="icon"
          variant="ghost"
        >
          <Redo2 data-icon="inline-start" size={16} />
        </Button>
      </Hint>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Play button */}
      <Hint label={isPlaying ? "暂停" : "播放预览"}>
        <Button
          className="rounded-xl shadow-sm hover:scale-[1.03]"
          onClick={onTogglePlay}
          size="icon-lg"
          variant="primary-solid"
        >
          {isPlaying ? (
            <svg
              data-icon="inline-start"
              fill="currentColor"
              height="18"
              viewBox="0 0 24 24"
              width="18"
            >
              <rect height="16" rx="1" width="4" x="6" y="4" />
              <rect height="16" rx="1" width="4" x="14" y="4" />
            </svg>
          ) : (
            <svg
              data-icon="inline-start"
              fill="currentColor"
              height="18"
              viewBox="0 0 24 24"
              width="18"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </Button>
      </Hint>

      <div className="w-3" />

      {/* 缩放标签 + 导出 */}
      <span className="text-ink-faintest text-2xs">时间轴缩放</span>
      <Button
        className="bg-subtle h-auto gap-1.5 rounded-lg px-3.5 py-1.5 font-semibold"
        disabled={
          c.loading ||
          !c.videoWorkflowId ||
          (c.shotSource === "project" && (!c.activeProjectId || c.projectShotCount === 0))
        }
        // oxlint-disable-next-line no-void -- reject 由 action 内部捕获
        onClick={() => void (c.shotSource === "project" ? c.createFromProject() : c.create())}
        size="sm"
        variant="primary"
      >
        {c.loading ? "启动中…" : c.shotSource === "project" ? "用项目镜头成片" : "导出成片"}
      </Button>

      {/* 取消按钮（运行中时） */}
      {c.film && c.running && (
        <Button
          className="border-border text-ink-strong hover:bg-surface-2 h-auto rounded-lg px-3 py-1.5"
          // oxlint-disable-next-line no-void -- reject 由 action 内部捕获
          onClick={() => void c.cancel()}
          size="xs"
          variant="outline"
        >
          取消
        </Button>
      )}
    </header>
  );
}
