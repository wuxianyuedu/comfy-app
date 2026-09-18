"use client";

import React from "react";
import { isVideo } from "~/lib/media/media";

/**
 * 渲染媒体缩略图：视频就地播放，图片直接显示。
 * WorksGallery 与 HistoryList 都用它，所以两者都支持视频播放。
 */
export const MediaThumbnail = React.memo(function MediaThumbnail({
  src,
  alt = "",
  className = "",
  autoPlay = false,
  muted = true,
  loop = false,
}: {
  src?: string | null;
  alt?: string;
  className?: string;
  autoPlay?: boolean;
  muted?: boolean;
  loop?: boolean;
}) {
  if (!src) return null;
  if (isVideo(src)) {
    return (
      <video
        src={src}
        className={className}
        autoPlay={autoPlay}
        muted={muted}
        loop={loop}
        playsInline
        preload="metadata"
      />
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
    />
  );
});
