/** Detect whether a media source URL is a playable video (vs an image/GIF). */
export function isVideo(src?: string | null): boolean {
  if (!src) return false;
  // NOTE: .gif is NOT a video — it must render as <img> (animated image),
  // a <video> element cannot decode GIF files and would show black/blank.
  return /\.(mp4|webm|ogg|m4v|mov)$/i.test(src);
}
