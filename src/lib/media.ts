/* ── 媒体源的 `<video>` / `<audio>` 渲染判据 ─────────────────────────
 *
 * 判据本身（扩展名集合）已收敛到 `media-kind.ts`（ISSUE #571）；本模块只保留
 * 对外的兼容出口，避免一次性改动所有调用方的 import 路径。
 *
 * 新代码请直接 `import { isVideo, isAudio, kindOf } from "@/lib/media-kind"`。
 */
export { kindOf, isAudio, isVideo, type MediaKind } from "./media-kind";
