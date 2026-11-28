/** 打斗动作库：声明式、可复用的招式定义（P2）。
 *
 * 这是**数据**不是代码：内置招式以关键帧描述姿态与特效，渲染后端（P3 的 Three.js）
 * 或提示词编译器（P0/P1 的 comfy 通道）各自消费。LLM 生成合同时只能引用招式 id
 * 或给自定义动作，绝不在这里执行任意脚本。 */
import { z } from "zod";

/** 一个姿态关键帧：相对动作起点的秒数 + 姿态描述 + 缓动 + 特效。 */
export const poseKeyframeSchema = z
  .object({
    /** 相对动作起点的秒数。 */
    t: z.number().nonnegative(),
    /** 姿态描述（人类可读，供提示词与渲染器共用）。 */
    pose: z.string().min(1),
    /** 缓动曲线名（ease-in / ease-out / linear 等，渲染器自行解释）。 */
    easing: z.string().default("ease-out"),
    /** 特效引用（fx id），无特效时省略。 */
    fxRef: z.string().optional(),
  })
  .strict();

/** 一个可复用招式。 */
export const actionDefSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    /** 招式总时长（秒）。 */
    duration: z.number().positive(),
    /** 是否需要目标实体（挥拳需要、蓄力不需要）。 */
    needsTarget: z.boolean().default(false),
    keyframes: z.array(poseKeyframeSchema).min(1),
  })
  .strict();

export type PoseKeyframe = z.output<typeof poseKeyframeSchema>;
export type ActionDef = z.output<typeof actionDefSchema>;

/** 内置招式表（打斗场景的起承转合词汇）。LLM 可在合同里直接引用这些 id。 */
export const BUILTIN_ACTIONS: ReadonlyArray<ActionDef> = [
  {
    duration: 0.8,
    id: "charge",
    keyframes: [
      { t: 0, pose: "重心下沉，手臂后收蓄力", easing: "ease-in" },
      { t: 0.45, pose: "肌肉绷紧，衣摆翻起", easing: "ease-in" },
      { t: 0.8, pose: "蓄力完成，能量汇聚于拳", easing: "linear", fxRef: "energy-gather" },
    ],
    label: "蓄力",
    needsTarget: false,
  },
  {
    duration: 0.5,
    id: "punch",
    keyframes: [
      { t: 0, pose: "转胯送肩，拳头出发", easing: "ease-in" },
      { t: 0.25, pose: "拳头高速前送，身形前倾", easing: "linear", fxRef: "speed-lines" },
      { t: 0.5, pose: "拳峰抵近目标，定格", easing: "ease-out" },
    ],
    label: "挥拳",
    needsTarget: true,
  },
  {
    duration: 0.6,
    id: "dodge",
    keyframes: [
      { t: 0, pose: "察觉来势，重心横移", easing: "ease-out" },
      { t: 0.3, pose: "侧身闪过，衣角带残影", easing: "linear", fxRef: "afterimage" },
      { t: 0.6, pose: "落到新站位，回头看向目标", easing: "ease-out" },
    ],
    label: "闪避",
    needsTarget: true,
  },
  {
    duration: 0.7,
    id: "impact",
    keyframes: [
      { t: 0, pose: "命中瞬间，接触点压缩", easing: "linear" },
      { t: 0.2, pose: "冲击波沿地面扩散", easing: "ease-out", fxRef: "shockwave" },
      { t: 0.7, pose: "烟尘升起，碎片回落", easing: "ease-out", fxRef: "dust" },
    ],
    label: "冲击",
    needsTarget: true,
  },
  {
    duration: 0.9,
    id: "knockback",
    keyframes: [
      { t: 0, pose: "被击中，身体后仰", easing: "ease-in" },
      { t: 0.35, pose: "整个人被推开，双脚离地", easing: "linear", fxRef: "speed-lines" },
      { t: 0.9, pose: "重重落地，滑行停住", easing: "ease-out", fxRef: "dust" },
    ],
    label: "被击退",
    needsTarget: false,
  },
  {
    duration: 1.2,
    id: "sweep",
    keyframes: [
      { t: 0, pose: "扫帚平举，目光抬起", easing: "ease-out" },
      { t: 0.5, pose: "横扫一周，气流卷起落叶", easing: "linear", fxRef: "wind-sweep" },
      { t: 1.2, pose: "收势，云层从行星四周散开", easing: "ease-out", fxRef: "cloud-part" },
    ],
    label: "一扫",
    needsTarget: false,
  },
];

/** 招式 id 集合（QA 校验引用用）。 */
export function builtinActionIds(): Set<string> {
  return new Set(BUILTIN_ACTIONS.map((action) => action.id));
}

/** 按 id 查内置招式；找不到返回 undefined。 */
export function findBuiltinAction(id: string): ActionDef | undefined {
  return BUILTIN_ACTIONS.find((action) => action.id === id);
}
