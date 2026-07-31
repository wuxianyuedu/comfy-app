"use client";

import React from "react";

export function isVideo(src?: string | null): boolean {
  if (!src) return false;
  return /\.(mp4|webm|ogg|gif)$/i.test(src);
}

/**
 * Renders a media thumbnail that plays video inline or shows an image.
 * Used by WorksGallery and HistoryList so both support video playback.
 */
export function MediaThumb({
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
      <video src={src} className={className} autoPlay={autoPlay} muted={muted} loop={loop} playsInline />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} />;
}
