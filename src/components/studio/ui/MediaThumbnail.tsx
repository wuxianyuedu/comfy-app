"use client";

import React from "react";
import { isVideo } from "@/lib/media";

/**
 * Renders a media thumbnail that plays video inline or shows an image.
 * Used by WorksGallery and HistoryList so both support video playback.
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
