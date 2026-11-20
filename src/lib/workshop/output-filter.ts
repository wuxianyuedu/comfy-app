/** 工坊产物回调的媒体过滤，全库唯一判据（#4596）。
 *
 *  产物事件的 `kind` 除了 image / video 还有 `other`（ShowText 类输出节点、
 *  未知 `{filename}` 数组都会落成它）。此前的四处调用点各自写「排除另一种」
 *  的宽过滤，后到的 other 产物会把已写入的 imageUrl / clipUrl 覆盖成
 *  txt/杂项地址——画廊坏图、成片素材被污染。这里按**命中本媒体**精确收：
 *  非本媒体的产物（含 other）一律不进回写。 */

import type { SavedOutput } from "./api-channel-shared";

export type OutputTarget = "image" | "video";

export function isWantedOutput(target: OutputTarget, out: Pick<SavedOutput, "kind">): boolean {
  return out.kind === target;
}
