"use client";
/* 影片工坊顶部工具栏 —— 项目名 / 撤销重做 / 播放 / 导出成片 / 取消。 */
import { Redo2, Undo2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";
import type { FilmStudioController } from "./hooks/use-film-studio";

interface FilmStudioTopBarProps {
  c: FilmStudioController;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

export function FilmStudioTopBar({
  c,
  isPlaying,
  onTogglePlay,
  onUndo,
  onRedo,
}: FilmStudioTopBarProps) {
  return (
    <header className="border-border-subtle bg-panel/88 z-base relative flex shrink-0 items-center gap-3 border-b px-4 py-0 backdrop-blur-md">
      {/* Project name */}
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="font-title u-title-page min-w-0 truncate">{c.title}</h1>
        <span className="text-ink-fainter text-xs">· 视频成片工作室</span>
      </div>

      <div className="bg-surface-2 h-5 w-px" />

      {/* Undo / Redo */}
      <Hint label="撤销" accessibleName>
        <Button
          variant="ghost"
          size="icon"
          onClick={onUndo}
          className="text-ink-muted hover:bg-subtle hover:text-ink-strong rounded-lg"
        >
          <Undo2 data-icon="inline-start" size={16} />
        </Button>
      </Hint>
      <Hint label="重做" accessibleName>
        <Button
          variant="ghost"
          size="icon"
          onClick={onRedo}
          className="text-ink-muted hover:bg-subtle hover:text-ink-strong rounded-lg"
        >
          <Redo2 data-icon="inline-start" size={16} />
        </Button>
      </Hint>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Play button */}
      <Hint label={isPlaying ? "暂停" : "播放预览"}>
        <Button
          variant="primary-solid"
          size="icon-lg"
          onClick={onTogglePlay}
          className="rounded-xl shadow-sm hover:scale-[1.03]"
        >
          {isPlaying ? (
            <svg
              data-icon="inline-start"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg
              data-icon="inline-start"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="currentColor"
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
        variant="primary"
        size="sm"
        onClick={() =>
          void (c.shotSource === "project" ? c.createFromProject() : c.create())
        }
        disabled={
          c.loading ||
          !c.videoWorkflowId ||
          (c.shotSource === "project" &&
            (!c.activeProjectId || c.projectShotCount === 0))
        }
        className="bg-subtle h-auto gap-1.5 rounded-lg px-3.5 py-1.5 font-semibold"
      >
        {c.loading
          ? "启动中…"
          : c.shotSource === "project"
            ? "用项目镜头成片"
            : "导出成片"}
      </Button>

      {/* 取消按钮（运行中时） */}
      {c.film && c.running && (
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
  );
}
