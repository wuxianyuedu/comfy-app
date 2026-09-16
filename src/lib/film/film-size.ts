/** 短片的尺寸口径（成片画幅 + 单镜兜底）。
 *
 *  尺寸只按 `lib/size-presets` 的两种表达走（比例 + 分辨率 / 比例 + 百万像素 +
 *  倍数）；本模块只放短片特有的两个常量，前后端共用（故只依赖 size-presets，
 *  不把整个 orchestrator 拖进路由）。 */

import { DEFAULT_SIZE_SPEC, type SizeSpec } from "@/lib/size-presets";

/** 成片画幅默认值：视频场景 16:9 1k（= 1280×720，与历史默认逐字相同）。
 *
 *  用户在「尺寸表配置」里改过视频场景的 16:9 1k，成片画幅跟着改。 */
export const FILM_COMPOSE_SIZE: SizeSpec = {
  ...DEFAULT_SIZE_SPEC,
  ratio: "16:9 横屏",
};

/** 单镜视频的**底模原生分辨率**（Wan2.x 这类视频模型按 832×480 训练 / 推理最稳）。
 *
 *  刻意不换成尺寸表的档位：它不是「比例 + 档位」表达，而是模型自身的输入规格
 *  （换成 1280×720 会明显掉质量）。只在镜头没带尺寸时兜底。 */
export const NATIVE_SHOT_VIDEO_SIZE = "832x480";
