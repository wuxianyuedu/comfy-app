/** 短片的尺寸口径（成片画幅 + 单镜兜底）。
 *
 *  尺寸只按 `lib/size-presets` 的两种表达走（比例 + 分辨率 / 比例 + 百万像素 +
 *  倍数）；本模块只放短片特有的两个常量，前后端共用（故只依赖 size-presets，
 *  不把整个 orchestrator 拖进路由）。 */

import { DEFAULT_SIZE_SPEC, type SizeSpec } from "@/lib/size-presets";

/** 成片画幅默认值：视频场景 16:9 1k（= 1280×720，与历史默认逐字相同）。
 *
 *  用户在「尺寸表配置」里改过视频场景的 16:9 1k，成片画幅跟着改。 */
export const FILM_COMPOSE_SIZE: SizeSpec = { ...DEFAULT_SIZE_SPEC, ratio: "16:9 横屏" };

/** 单镜视频的**尺寸表达兜底**（镜头没带尺寸时用）。
 *
 *  与「成片画幅」分开：单镜按视频场景的 1k 档派值，成片再按 `FILM_COMPOSE_SIZE`
 *  缩放（两件事，别共用一个常量）。 */
export const NATIVE_SHOT_VIDEO_SIZE: SizeSpec = {
  ...DEFAULT_SIZE_SPEC,
  ratio: "16:9 横屏",
};
