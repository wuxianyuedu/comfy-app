"use client";
/* 影片工坊左栏：分镜列表（260px）。项目来源显示真实镜头
 * （缩略图 / 时长 / 状态 + 评审 / 退回重做入口），否则维持样例时间轴。 */
import { ClipboardCheck } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import type { FilmStudioController } from "./hooks/use-film-studio";
import {
  MODE_LABELS,
  STATUS_BADGE,
  type ShotListItem,
} from "./film-studio-config";

interface FilmStudioShotListPanelProps {
  c: FilmStudioController;
  listShots: ShotListItem[];
  selectedShotId: string;
  isProjectSource: boolean;
  onSelectShot: (id: string) => void;
  onAddShot: () => void;
  onReviewShot: (shot: ShotListItem) => void;
}

export function FilmStudioShotListPanel({
  c,
  listShots,
  selectedShotId,
  isProjectSource,
  onSelectShot,
  onAddShot,
  onReviewShot,
}: FilmStudioShotListPanelProps) {
  return (
    <aside className="border-border-subtle bg-panel-deep/85 flex w-65 shrink-0 flex-col border-r backdrop-blur-sm">
      {/* Header */}
      <div className="border-border-subtle flex h-11 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <span className="text-ink-field text-[13px] font-semibold">
            分镜列表
          </span>
          <span className="text-ink-fainter text-[11px]">
            {listShots.length} 镜头
          </span>
        </div>
        {!isProjectSource && (
          <Hint label="新增镜头" accessibleName>
            <Button
              variant="primary"
              size="icon-xs"
              onClick={onAddShot}
              className="rounded-md"
            >
              +
            </Button>
          </Hint>
        )}
      </div>

      {/* Shot items */}
      <div className="flex-1 flex-col gap-1.5 overflow-y-auto p-2">
        {listShots.map((shot) => {
          const badge = STATUS_BADGE[shot.status];
          const isSelected = shot.id === selectedShotId;
          return (
            <div
              key={shot.id}
              className={`flex items-center gap-1 rounded-xl border transition-all ${
                isSelected
                  ? "border-primary-500/40 bg-primary-500/12 shadow-sm shadow-black/5 dark:shadow-black/10"
                  : "bg-card hover:border-border border-transparent"
              }`}
            >
              <Button
                variant="ghost"
                onClick={() => onSelectShot(shot.id)}
                className="group flex h-auto min-w-0 flex-1 items-center gap-3 rounded-xl p-2.5 text-left font-normal"
              >
                {/* Thumbnail：项目镜头有产出图则显缩略图，否则占位 */}
                {shot.thumbnailUrl ? (
                  <MediaThumbnail
                    src={shot.thumbnailUrl}
                    className="h-12 w-14 shrink-0 rounded-md object-cover"
                  />
                ) : (
                  <div
                    className={`flex h-12 w-14 shrink-0 items-center justify-center rounded-md text-[10px] ${
                      isSelected
                        ? "bg-primary/10 text-primary-strong"
                        : "bg-subtle text-ink-faintest"
                    }`}
                  >
                    镜头缩略图
                  </div>
                )}

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

              {/* 项目镜头才给「退回让 AI 重做」入口（与画布镜头节点同源 requestShotRedo）。 */}
              {isProjectSource && (
                <>
                  <Hint
                    label="AI 评审这一镜（不合格可抽卡 / 改提示词重生成）"
                    accessibleName
                  >
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => onReviewShot(shot)}
                      className="text-ink-soft hover:bg-primary/15 shrink-0"
                    >
                      <ClipboardCheck data-icon="inline-start" />
                    </Button>
                  </Hint>
                  <Hint label="退回让 AI 重做这一镜" accessibleName>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => void c.redoShot(shot.id)}
                      className="text-ink-soft hover:bg-primary/15 mr-1 shrink-0"
                    >
                      ↺
                    </Button>
                  </Hint>
                </>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
