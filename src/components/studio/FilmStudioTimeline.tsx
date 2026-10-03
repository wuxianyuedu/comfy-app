"use client";
/* 影片工坊中栏的时间线：标尺 + 播放头 + 视频/字幕/BGM 三条轨道。 */
import { VIDEO_CLIPS } from "./film-studio-config";

interface FilmStudioTimelineProps {
  /** 播放头位置（px from timeline left）。 */
  playheadPos: number;
  bgmName: string | null;
}

export function FilmStudioTimeline({
  playheadPos,
  bgmName,
}: FilmStudioTimelineProps) {
  return (
    <div className="border-border-subtle bg-panel-deep/90 mt-auto rounded-xl border p-3 backdrop-blur-sm">
      {/* Time ruler */}
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-ink-faintest font-mono text-[10px]">00:00</span>
        <span className="text-ink-faintest font-mono text-[10px]">00:05</span>
        <span className="text-ink-faintest font-mono text-[10px]">00:10</span>
      </div>

      {/* Tracks container */}
      <div className="relative flex flex-col gap-1">
        {/* Playhead */}
        {/* p71-allow:start timeline playhead 红 · 视频剪辑行业的播放头视觉惯例、非错误状态色；走 bg-destructive 会被误读成「这里出错了」 */}
        <div
          className="z-base pointer-events-none absolute bottom-0 w-0.5 bg-red-400/80"
          style={{
            left: `${Math.min(playheadPos, 600)}px`,
            top: 0,
            height: "100%",
          }}
        >
          <div className="absolute -top-1 left-[-7px] h-2.5 w-4 rounded-sm bg-red-400/80" />
        </div>
        {/* p71-allow:end */}

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
            className="bg-success/15 ring-success/25 flex h-6 flex-1 items-center rounded px-2.5 ring-1 ring-inset"
            style={{ width: "280px" }}
          >
            <span className="text-info-strong truncate text-[9px]">
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
            className="bg-info/20 from-info/20 to-primary-500/20 flex h-6 flex-1 items-center rounded bg-linear-to-r px-2.5"
            style={{ width: "200px" }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-primary-strong)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mr-1.5 shrink-0"
            >
              <path d="M9 18V5l12-2v13M9 18a3 3 0 01-3-3H3a3 3 0 006 3z" />
            </svg>
            <span className="text-primary-strong truncate text-[9px]">
              {bgmName ?? "背景音乐 · 氛围感配乐"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
