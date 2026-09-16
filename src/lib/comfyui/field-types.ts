/**
 * 节点参数字段的控件类型。
 *
 * 与自定义节点 manifest 的 widget 标记、以及节点卡片上的值 chip 共用同一套
 * 字面量（原定义在旧流程画布的 `components/workflow-canvas/types.ts`）。
 */

/** 参数字段的控件类型。 */
export type FieldType =
  | "text" // multi-line prompt
  | "string" // single-line (ckpt_name, lora_name, etc.)
  | "number" // steps, cfg, seed, denoise, strength
  | "select" // sampler_name, scheduler (dropdown)
  | "toggle" // boolean flags
  | "image" // image upload / reference
  | "latent"; // latent size (width x height)
