"use client";

import React from "react";

export function isVideo(src?: string | null): boolean {
  if (!src) return false;
  // NOTE: .gif is NOT a video — it must render as <img> (animated image),
  // a <video> element cannot decode GIF files and would show black/blank.
  return /\.(mp4|webm|ogg|m4v|mov)$/i.test(src);
}

/**
 * Renders a media thumbnail that plays video inline or shows an image.
 * Used by WorksGallery and HistoryList so both support video playback.
 */
export const MediaThumb = React.memo(function MediaThumb({
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
      <video src={src} className={className} autoPlay={autoPlay} muted={muted} loop={loop} playsInline preload="metadata" />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} loading="lazy" decoding="async" />;
});
