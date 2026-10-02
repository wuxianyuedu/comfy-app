/**
 * `model.type` 这一列的中文标签与筛选档位（唯一出处）。
 *
 * 为什么单独一份：此前标签表 `TYPE_LABEL` 长在 `ModelCard.tsx` 里、筛选档位
 * `FILTERS` 长在 `ModelLibrary.tsx` 里，两份各自列举同一批类型 —— 结果就是
 * 标签表认识 `UPSCALE`、筛选里没有它：用户界面上「放大」这一类模型能被渲染出
 * 徽标，却没有任何一档能筛出它们（§12.12 同一件事的第二个名字）。
 *
 * 筛选档位由标签表**派生**，新增一类只需要改这一处。
 *
 * 注意别与 `~/lib/model-types.ts` 混：那份按 ComfyUI 的**目录名**（checkpoints /
 * loras / …）给元数据，是另一个轴；这里管的是数据库里 `model.type` 那一列的枚举值。
 */

/** 数据库 `model.type` 的已知取值 → 中文标签。 */
export const MODEL_TYPE_LABELS: Record<string, string> = {
  CHECKPOINT: "大模型",
  LORA: "LoRA",
  CONTROLNET: "控制网",
  VAE: "VAE",
  EMBEDDING: "嵌入",
  UPSCALE: "放大",
};

/** 筛选档位：第一项是「全部」（`key` 为空串 = 不下发 type 参数）。 */
export interface ModelTypeFilter {
  key: string;
  label: string;
}

export const ALL_TYPES_FILTER: ModelTypeFilter = { key: "", label: "全部" };

/** 由标签表派生的完整档位表（顺序即展示顺序）。 */
export const MODEL_TYPE_FILTERS: ModelTypeFilter[] = [
  ALL_TYPES_FILTER,
  ...Object.entries(MODEL_TYPE_LABELS).map(([key, label]) => ({ key, label })),
];

/** 取某一类的展示名；未知类型原样回显（不猜、不套「大模型」）。 */
export function modelTypeLabel(type: string | null | undefined): string {
  if (!type) return "";
  return MODEL_TYPE_LABELS[type] ?? type;
}
