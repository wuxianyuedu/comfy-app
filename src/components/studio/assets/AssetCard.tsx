"use client";

/**
 * `AssetCard` — 资产库网格里的单张资产卡（ISSUE #4868）：
 * 方形缩略图 + 类型 / 归属徽标 + 名称 + 分类 + 参数完整度，操作只有
 * 「详情 / 删除」两件（重生成走详情里的「用此参数生成」）。
 * 纯展示组件：数据与回调都由 AssetLibrary 注入（规范 17 §17.2 第③层）。
 */
import { FileText, Music, Settings2, Trash2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { ViewableImage } from "~/components/ui/image-viewer";
import { TruncatedText } from "~/components/ui/truncated-text";
import { cn } from "~/lib/utils";

import { assetCategoryLabel, assetScopeLabel } from "./asset-categories";
import type { AssetListItem } from "./hooks/use-asset-library";

export type AssetCardProps = {
  asset: AssetListItem & { createdAt: string };
  onOpenDetail: (id: string) => void;
  onRemove: (asset: AssetListItem & { createdAt: string }) => void;
};

/** 类型徽标的文案（mediaType → 短名）。 */
function mediaTypeLabel(mediaType: string): string {
  switch (mediaType) {
    case "video": {
      return "视频";
    }
    case "audio": {
      return "音乐";
    }
    case "document": {
      return "文档";
    }
    default: {
      return "图片";
    }
  }
}

export function AssetCard({ asset, onOpenDetail, onRemove }: AssetCardProps) {
  const isVideo = asset.mediaType === "video";
  return (
    <div
      className="group bg-card border-border-subtle relative flex flex-col overflow-hidden rounded-xl border transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-black/25"
      data-asset-id={asset.id}
    >
      {/* ── 方形缩略图（设计稿定稿：图占主体、正方形）── */}
      <div className="bg-panel-deep relative aspect-square w-full overflow-hidden">
        {asset.localPath === "" ? (
          <span className="text-ink-fainter flex size-full items-center justify-center text-xs">
            无预览
          </span>
        ) : isVideo ? (
          <MediaThumbnail
            alt={asset.name}
            autoPlay
            className="h-full w-full object-cover"
            loop
            muted
            src={asset.localPath}
          />
        ) : asset.mediaType === "image" ? (
          <ViewableImage
            alt={asset.name}
            className="h-full w-full object-cover"
            label={asset.name}
            src={asset.localPath}
          />
        ) : (
          /* 音频 / 文档：没有可预览的画面，给占位图形 */
          <span className="text-ink-fainter flex size-full items-center justify-center">
            {asset.mediaType === "audio" ? (
              <Music aria-hidden className="size-10" />
            ) : (
              <FileText aria-hidden className="size-10" />
            )}
          </span>
        )}
        {/* 类型徽标（左上）+ 归属徽标（右上）：与设计稿一致。 */}
        <span className="text-2xs absolute top-2 left-2 rounded-full bg-black/55 px-2 py-0.5 font-medium text-white">
          {mediaTypeLabel(asset.mediaType)}
        </span>
        <span
          className={cn(
            "text-2xs absolute top-2 right-2 rounded-full px-2 py-0.5 font-medium",
            asset.scope === "public"
              ? "bg-primary-soft text-primary-strong"
              : "bg-black/55 text-white",
          )}
        >
          {assetScopeLabel(asset.scope)}
        </span>
      </div>

      {/* ── 信息区：名称 + 分类 · 子目录 + 参数完整度 + 操作 ── */}
      <div className="flex flex-col gap-1.5 p-3">
        <TruncatedText className="text-ink-strong truncate text-sm font-medium">
          {asset.name}
        </TruncatedText>
        <p className="text-ink-fainter text-2xs truncate">
          {assetCategoryLabel(asset.category)}
          {asset.subdir !== null && asset.subdir !== "" ? ` · ${asset.subdir}` : ""}
        </p>
        <div className="flex items-center gap-2">
          {asset.hasParams ? (
            <span className="text-success-strong text-2xs font-medium">● 参数完整</span>
          ) : (
            <span className="text-warning-strong text-2xs font-medium">● 缺生成参数</span>
          )}
          <div className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
            <Button
              aria-label={`查看 ${asset.name} 的生成参数`}
              className="text-ink-faint hover:text-primary-strong size-7 rounded-md"
              onClick={() => {
                onOpenDetail(asset.id);
              }}
              size="icon-xs"
              variant="ghost"
            >
              {/* 「参数」语义的图标：这里打开的是详情弹窗（生成参数表 +
                  「用此参数生成」），不是放大——看大图点图片本身
                  （ViewableImage）。此前用 Maximize2 被读成冗余的放大按钮。 */}
              <Settings2 aria-hidden className="size-3.5" data-icon="inline-start" />
            </Button>
            <Button
              aria-label={`删除资产 ${asset.name}`}
              className="text-ink-faint hover:text-danger-strong size-7 rounded-md"
              onClick={() => {
                onRemove(asset);
              }}
              size="icon-xs"
              variant="ghost"
            >
              <Trash2 aria-hidden className="size-3.5" data-icon="inline-start" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
