/** 短片的尺寸口径（成片画幅 + 单镜兜底）。
 *
 *  尺寸只按 `lib/size-presets` 的两种表达走（比例 + 分辨率 / 比例 + 百万像素 +
 *  倍数）；本模块只放短片特有的两个常量，前后端共用（故只依赖 size-presets，
 *  不把整个 orchestrator 拖进路由）。 */

import { DEFAULT_SIZE_SPEC, toSizeSpec, type SizeSpec } from "~/lib/media/size-presets";

/** 成片画幅默认值：视频场景 16:9 1k（= 1280×720，与历史默认逐字相同）。
 *
 *  用户在「尺寸表配置」里改过视频场景的 16:9 1k，成片画幅跟着改。 */
export const FILM_COMPOSE_SIZE: SizeSpec = {
  ...DEFAULT_SIZE_SPEC,
  ratio: "16:9 横屏",
};

/** 单镜的**尺寸表达**（ISSUE #5138）：比例 + 1M + 倍数 64。
 *
 *  「1M / 64」这套写法**与场景无关**：图片场景与视频场景算出同一组宽高，
 *  MiniMax H3 这类图生视频才有「首帧与潜空间同尺寸」的前提。分场景的 1k 档
 *  会让出图侧按 1344×768、视频侧按 1280×720 算出两个 multiple，首帧编码时
 *  形状不匹配。成片画幅仍按 `FILM_COMPOSE_SIZE` 合成、逐镜归一化，两者分工。 */
export const NATIVE_SHOT_SIZE: SizeSpec = {
  ratio: "16:9 横屏",
  clarity: "1M",
  multiple: 64,
};

/** 旧名保留给存量调用方；语义与 `NATIVE_SHOT_SIZE` 完全一致。 */
export const NATIVE_SHOT_VIDEO_SIZE: SizeSpec = NATIVE_SHOT_SIZE;

/** 单镜画幅：沿用调用方给的比例（含预设全称 / 短标签），档位与倍数固定为场景无关档。 */
export function shotSizeFor(size: unknown = FILM_COMPOSE_SIZE): SizeSpec {
  return { ...NATIVE_SHOT_SIZE, ratio: toSizeSpec(size).ratio };
}
