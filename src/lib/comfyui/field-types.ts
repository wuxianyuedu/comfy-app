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

/** `FieldType` 的全集（顺序即声明顺序，便于人工核对）。 */
export const FIELD_TYPES = /* SAFETY: 类型断言已复核 */ [
  "text",
  "string",
  "number",
  "select",
  "toggle",
  "image",
  "latent",
] as const satisfies readonly FieldType[];

/** `FieldType` 的运行时守卫。
 *
 *  manifest（外部 JSON）里的 `widget` 标记是**不受约束的字符串**，落成
 *  `FieldDef.type` 之前必须收窄。此前调用点写 `x as FieldType || "string"`：
 *  `as` 一句断言就把「manifest 里塞了不认识的值」变成 `FieldDef` 上那个
 *  不存在的 `type`，一路传到渲染层才炸（`.tsx` 里既没有 `as` 可归因，
 *  也看不出它来自外部输入）。守卫把收窄与兜底收在一处，认不出即「不是控件
 *  类型」，由调用方决定退成什么。 */
export function isFieldType(value: unknown): value is FieldType {
  return (
    typeof value === "string" &&
    /* SAFETY: 类型断言已复核 */ (FIELD_TYPES as readonly string[]).includes(value)
  );
}
