"use client";

import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { displayValue } from "~/lib/display-value";
import { type Shot } from "~/lib/workshop/types";

import { shotFrameView } from "./shot-status-config";

/** 镜号统一成两位（`01`…`16`）：胶片带的意义是**扫**，宽度不齐就扫不动。 */
export function formatShotIndex(index: number): string {
  return String(index).padStart(2, "0");
}

/**
 * 镜头胶片带 —— 一排到底的镜头总览，点一帧跳到那一镜。
 *
 * 为什么值得加：`ShotStudio` 是一列纵向的镜头卡，逐镜看很合适，但回答不了
 * 「16 镜跑到哪了、哪几镜挂了」。列表要滚动才能数完全局，胶片带一眼就能扫完，
 * 而失败帧在带上是一个可见的缺口 —— 用户要做的下一件事往往就是补那个缺口。
 *
 * 刻意不做的两件事：
 *   · **不做选中态**（不挂 `aria-selected`）。这一屏的镜头列表没有「当前镜头」这个
 *     概念，凭空造一个选中态，读屏会念出一个界面里并不存在的事实。这里的语义是
 *     「跳到第 N 镜」，是一个导航动作。
 *   · **不显示假进度**。帧底那根条只表达状态（`shot-status-config` 的配色表），
 *     生成中的百分比在下面的镜头卡里给，那里有真实回报的数。
 */
export function ShotFilmStrip({
  shots,
  onJump,
}: {
  shots: Shot[];
  /** 跳到某一镜（由调用处决定是滚动定位还是同时展开那张卡）。 */
  onJump: (shot: Shot) => void;
}) {
  if (shots.length === 0) return null;

  const doneCount = shots.filter((shot) => shot.status === "done").length;
  const failedCount = shots.filter((shot) => shot.status === "failed").length;

  return (
    <section
      data-component="workshop-shot-filmstrip"
      aria-label="镜头胶片带"
      className="border-border bg-surface-1 rounded-xl border p-2"
    >
      <div className="mb-1.5 flex items-baseline gap-2 px-0.5">
        {/* 不是章节标题，是一行的标签：整条带的可访问名由 section 的 aria-label 给。
            工坊有「标题元素不许硬写字号、档位归一档」的判据，这里本来也不该占一档。 */}
        <span className="text-ink-bright text-xs font-medium">镜头胶片带</span>
        <span className="text-ink-fainter text-[11px] tabular-nums">
          {doneCount}/{shots.length} 镜成图
          {failedCount > 0 ? ` · ${failedCount} 镜失败` : ""}
        </span>
      </div>

      {/* 横向滚动条走 `.custom-scrollbar`（globals.css 里那份），不自绘滚动条 */}
      <div className="custom-scrollbar flex gap-1.5 overflow-x-auto pb-1">
        {shots.map((shot) => {
          const frame = shotFrameView(shot.status);
          const heading = shot.sceneHeading?.trim();
          return (
            <Hint
              key={shot.id}
              label={`#${formatShotIndex(shot.index)} ${heading || displayValue(null)} · ${frame.label}`}
            >
              <Button
                type="button"
                variant="ghost"
                onClick={() => onJump(shot)}
                aria-label={`跳到镜头 ${formatShotIndex(shot.index)}${heading ? ` · ${heading}` : ""} · ${frame.label}`}
                className={
                  // 固定尺寸 + 不收缩：一帧被压扁，整条带子的对齐就没了。
                  // `p-0` 把按钮内边距让给封面；状态条贴在底边，不参与布局。
                  "relative size-16 shrink-0 overflow-hidden rounded-lg border p-0 transition-colors" +
                  (shot.status === "failed"
                    ? " border-destructive/50 bg-destructive/10"
                    : " border-border bg-subtle hover:bg-surface-2")
                }
              >
                {shot.imageUrl ? (
                  <MediaThumbnail
                    src={shot.imageUrl}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  /* 还没有成图：给出镜号本身，而不是一个灰块 —— 空帧也要说得出
                     「这是第几镜、还没出图」。 */
                  <span className="text-ink-fainter flex size-full items-center justify-center text-[13px] tabular-nums">
                    {formatShotIndex(shot.index)}
                  </span>
                )}

                {/* 镜角标：有封面时盖在图上，仍要能看出是第几镜 */}
                {shot.imageUrl && (
                  <span className="absolute top-0.5 left-0.5 rounded bg-black/45 px-1 text-[9px] leading-4 text-white tabular-nums backdrop-blur-sm">
                    {formatShotIndex(shot.index)}
                  </span>
                )}

                <span
                  aria-hidden
                  className={`absolute inset-x-0 bottom-0 h-1 ${frame.barClass}`}
                />
              </Button>
            </Hint>
          );
        })}
      </div>
    </section>
  );
}
