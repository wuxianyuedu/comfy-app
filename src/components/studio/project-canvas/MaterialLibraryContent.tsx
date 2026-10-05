"use client";

/**
 * 素材库面板的「内容区」拆分件（§17.12 视图二次拆分：只动 JSX 物理位置，
 * 不动行为）——骨架 / 空态 / 条目网格与列表 / 分类（网格与列表）四态。
 *
 * 分类识别色（KIND_STYLE）与文件夹装饰色（FOLDER_ICON_TINT）随迁：
 * 只剩本文件消费，§3.6.1 的 p71-allow 例外块照原文保留。
 *
 * 数据与动作经 `c`（MaterialLibraryController）注入，本组件零 IO。
 */
import {
  ChevronRight,
  Download,
  FileText,
  Folder,
  Image as ImageIcon,
  Music,
  Plus,
  Trash2,
  Video,
} from "lucide-react";

import { Hint } from "~/components/ui/hint";
import { MediaThumbnail as MediaThumb } from "~/components/ui/media-thumbnail";
import { mediaDragSourceProps } from "~/components/ui/media-drag-source";
import { fmtBytes } from "~/lib/format-bytes";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { displayValue } from "~/lib/display-value";
import type { MaterialItem } from "~/lib/media/materials-client";
import type { MaterialLibraryController } from "./hooks/use-material-library";

// p71-allow:start 媒体分类识别色 + 文件夹装饰色——§3.6.1 文档化例外，颜色本身即语义
const KIND_STYLE: Record<string, string> = {
  image: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  video: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  audio: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  doc: "bg-subtle text-ink-soft",
};

/** 文件夹图标块（列表 / 网格两处都用；容器边长/圆角由调用方加）。 */
const FOLDER_ICON_TINT =
  "bg-linear-to-br from-yellow-500/20 to-orange-500/10 text-yellow-700/90 dark:text-yellow-400/80";
// p71-allow:end

function KindIcon({ kind }: { kind: string }) {
  if (kind === "image") return <ImageIcon size={18} strokeWidth={1.8} />;
  if (kind === "video") return <Video size={18} strokeWidth={1.8} />;
  if (kind === "audio") return <Music size={18} strokeWidth={1.8} />;
  return <FileText size={18} strokeWidth={1.8} />;
}

export function MaterialLibraryContent({
  c,
  display,
  onUse,
  onOpenUploadPicker,
  gridColsClass = "grid-cols-2",
  folderColsClass = "grid-cols-3",
}: {
  c: MaterialLibraryController;
  /** 显示密度（网格/列表）：纯视觉偏好，由父组件持有。 */
  display: "grid" | "list";
  onUse?: (item: MaterialItem) => void;
  onOpenUploadPicker: () => void;
  /**
   * 网格形态下的列数。**默认值是画布抽屉（360px 宽）的口径**——本组件因此
   * 在窄栏与整页两种容器里都能用，而条目 / 骨架 / 空态四态仍只有一份实现。
   * 传断点类（如 `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5`）即可按容器拉宽。
   */
  gridColsClass?: string;
  /** 分类（文件夹）网格形态下的列数，同上。 */
  folderColsClass?: string;
}) {
  const { folders, items, loading, showItems, searching, enterFolder, remove } =
    c;

  return (
    <div className="min-w-0 flex-1 overflow-y-auto px-2 pb-4">
      {loading ? (
        /* Skeleton */
        <div className="flex-col gap-1 px-2 pt-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={`skeleton-${i}`} className="flex items-center gap-3 py-2">
              <Skeleton className="bg-subtle size-9 shrink-0 rounded-lg" />
              <Skeleton className="bg-subtle h-3 flex-1 rounded" />
            </div>
          ))}
        </div>
      ) : showItems ? (
        items.length === 0 ? (
          /* 空状态：大图标 + 提示文案 + 操作引导 */
          <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
            {/* 文件夹图标 */}
            <div className="border-border-strong bg-subtle mb-5 flex size-20 items-center justify-center rounded-2xl border">
              <Folder
                size={40}
                strokeWidth={1.2}
                className="text-ink-fainter"
              />
            </div>
            <p className="text-ink-soft text-[14px] font-medium">
              {searching ? "没有匹配的素材" : "暂无内容"}
            </p>
            {!searching && (
              <div className="text-ink-fainter mt-4 flex-col gap-2 text-xs">
                <Button
                  variant="ghost"
                  onClick={onOpenUploadPicker}
                  className="hover:text-primary-strong flex h-auto items-center gap-2 font-normal hover:bg-transparent"
                >
                  <Plus data-icon="inline-start" size={14} />
                  点击 + 或右键菜单创建内容
                </Button>
                <p className="flex items-center gap-2">
                  <Download size={14} strokeWidth={1.8} />
                  也可以从画布拖入素材保存到这里
                </p>
              </div>
            )}
          </div>
        ) : display === "grid" ? (
          /* 网格视图 */
          <div className={`grid ${gridColsClass} gap-2 px-1 pt-1`}>
            {items.map((item) => (
              <div
                key={item.id}
                {...mediaDragSourceProps({
                  url: item.url,
                  displayName: item.name,
                  kind: item.kind,
                  className:
                    "group border-border-strong bg-subtle relative overflow-hidden rounded-lg border",
                })}
              >
                <div className="bg-canvas-deep flex aspect-square items-center justify-center overflow-hidden">
                  {item.kind === "image" || item.kind === "video" ? (
                    <MediaThumb
                      src={item.url}
                      alt={item.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div
                      className={`flex size-12 items-center justify-center rounded-lg ${KIND_STYLE[item.kind]}`}
                    >
                      <KindIcon kind={item.kind} />
                    </div>
                  )}
                </div>
                <p className="text-ink-soft text-2xs truncate px-2 py-1.5">
                  {item.name}
                </p>
                {/* hover 操作 */}
                <div className="absolute top-1 right-1 hidden gap-1 group-hover:flex">
                  {onUse && (
                    <Hint label="加入画布" accessibleName>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => onUse(item)}
                        className="text-ink-soft rounded bg-black/60 backdrop-blur hover:bg-black/60 hover:text-white"
                      >
                        <Plus
                          data-icon="inline-start"
                          size={12}
                          strokeWidth={2.5}
                        />
                      </Button>
                    </Hint>
                  )}
                  <Hint label="删除" accessibleName>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => void remove(item)}
                      className="text-ink-soft hover:text-destructive rounded bg-black/60 backdrop-blur hover:bg-black/60"
                    >
                      <Trash2 data-icon="inline-start" size={12} />
                    </Button>
                  </Hint>
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* 列表视图 */
          <div className="flex flex-col gap-0.5">
            {items.map((item) => (
              <div
                key={item.id}
                {...mediaDragSourceProps({
                  url: item.url,
                  displayName: item.name,
                  kind: item.kind,
                  className:
                    "hover:bg-subtle group flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors",
                })}
              >
                {item.kind === "image" || item.kind === "video" ? (
                  <div className="bg-canvas-deep size-9 shrink-0 overflow-hidden rounded-lg">
                    <MediaThumb
                      src={item.url}
                      alt={item.name}
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : (
                  <div
                    className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${KIND_STYLE[item.kind]}`}
                  >
                    <KindIcon kind={item.kind} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-ink-bright truncate text-[13px]">
                    {item.name}
                  </p>
                  <p className="text-ink-fainter text-2xs mt-0.5">
                    {searching ? `${item.folderName} ·` : ""}
                    {displayValue(fmtBytes(item.size))}
                  </p>
                </div>
                <div className="hidden shrink-0 items-center gap-1 pr-1 group-hover:flex">
                  {onUse && (
                    <Hint label="加入画布" accessibleName>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => onUse(item)}
                        className="text-ink-muted hover:bg-subtle hover:text-ink-bright rounded-md"
                      >
                        <Plus
                          data-icon="inline-start"
                          size={13}
                          strokeWidth={2.5}
                        />
                      </Button>
                    </Hint>
                  )}
                  <a
                    href={item.url}
                    download={item.name}
                    draggable={false}
                    className="text-ink-muted hover:bg-subtle hover:text-ink-bright flex size-7 items-center justify-center rounded-md transition-colors"
                    title="下载"
                  >
                    <Download size={13} />
                  </a>
                  <Hint label="删除" accessibleName>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => void remove(item)}
                      className="text-ink-muted hover:bg-subtle hover:text-destructive rounded-md"
                    >
                      <Trash2 data-icon="inline-start" size={13} />
                    </Button>
                  </Hint>
                </div>
              </div>
            ))}
          </div>
        )
      ) : /* 分类列表 — 响应 display 网格/列表切换 */
      display === "grid" ? (
        <div className={`grid ${folderColsClass} gap-2 px-1 pt-1`}>
          {folders.map((folder) => (
            <Button
              key={folder.id}
              variant="ghost"
              onClick={() => enterFolder(folder.id)}
              className="border-border-strong bg-subtle hover:bg-surface-2 hover:border-ink-fainter group flex h-auto flex-col items-center gap-2 rounded-lg border py-4 font-normal transition-colors"
            >
              <div
                className={`flex size-12 items-center justify-center rounded-xl ${FOLDER_ICON_TINT}`}
              >
                <Folder size={22} strokeWidth={1.8} />
              </div>
              <span className="text-ink-soft min-w-0 truncate text-center text-xs">
                {folder.name}
              </span>
              {folder.count > 0 && (
                <span className="text-ink-fainter text-3xs tabular-nums">
                  {folder.count}
                </span>
              )}
            </Button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {folders.map((folder) => (
            <Button
              key={folder.id}
              variant="ghost"
              onClick={() => enterFolder(folder.id)}
              className="hover:bg-subtle group flex h-auto w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left font-normal transition-colors"
            >
              <div
                className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${FOLDER_ICON_TINT}`}
              >
                <Folder size={18} strokeWidth={1.8} />
              </div>
              <span className="text-ink-bright min-w-0 flex-1 truncate text-[13px]">
                {folder.name}
              </span>
              <span className="text-ink-fainter text-2xs shrink-0 tabular-nums">
                {folder.count > 0 ? folder.count : ""}
              </span>
              <ChevronRight
                data-icon="inline-start"
                size={12}
                strokeWidth={2.5}
                className="text-ink-fainter group-hover:text-ink-muted shrink-0"
              />
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
