"use client";
/* 影片工坊中栏的预览画布（16:9）：分辨率提示、播放覆盖层、
 * 生成中的品牌渐变进度条、完成后的成片播放器。 */
import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { ProgressBar } from "~/components/ui/progress-bar";
import type { FilmStudioController } from "./hooks/use-film-studio";
import { STAGE_LABEL } from "./film-studio-config";
import { sizeSpecSummary } from "~/lib/media/size-presets";

interface FilmStudioPreviewPanelProps {
  c: FilmStudioController;
  isPlaying: boolean;
  onTogglePlay: () => void;
}

export function FilmStudioPreviewPanel({
  c,
  isPlaying,
  onTogglePlay,
}: FilmStudioPreviewPanelProps) {
  return (
    <div className="border-border-subtle bg-canvas-deep relative mb-3 flex min-h-80 flex-1 items-center justify-center overflow-hidden rounded-2xl border">
      {/* Resolution hint：写尺寸表达（比例 + 档位），与全项目的尺寸口径一致。 */}
      <span className="text-ink-faintest bg-canvas-deep text-3xs absolute top-2.5 left-3 rounded px-2 py-0.5 font-mono">
        {sizeSpecSummary(c.size)} · {c.fps}fps
      </span>

      {/* Play overlay */}
      <Hint label={isPlaying ? "暂停" : "播放"}>
        <Button
          className="border-border-strong flex size-16 items-center justify-center rounded-full border bg-black/45 text-white shadow-lg shadow-black/6 transition-all hover:scale-105 hover:bg-black/55 active:scale-95 dark:shadow-black/30"
          onClick={onTogglePlay}
          variant="ghost"
        >
          {isPlaying ? (
            <svg
              data-icon="inline-start"
              fill="currentColor"
              height="28"
              viewBox="0 0 24 24"
              width="28"
            >
              <rect height="16" rx="1" width="4" x="6" y="4" />
              <rect height="16" rx="1" width="4" x="14" y="4" />
            </svg>
          ) : (
            <svg
              data-icon="inline-start"
              fill="currentColor"
              height="28"
              viewBox="0 0 24 24"
              width="28"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </Button>
      </Hint>

      {/* 影片进度覆盖层（生成中） */}
      {c.film && c.running && (
        <div className="absolute right-0 bottom-0 left-0 bg-black/75 px-4 py-2.5">
          <ProgressBar
            className="mb-1.5 text-xs"
            fillClassName="u-gradient-brand"
            label={
              <span className="text-ink-bright font-medium">{STAGE_LABEL[c.film.status]}</span>
            }
            trackClassName="bg-surface-2 h-1.5"
            value={c.film.progress}
          />
        </div>
      )}

      {/* 成片播放器（完成后） */}
      {c.film?.status === "DONE" && c.film.finalVideo && (
        <MediaThumbnail
          autoPlay
          className="absolute inset-0 h-full w-full bg-black object-contain"
          controls
          src={c.film.finalVideo}
        />
      )}
    </div>
  );
}
