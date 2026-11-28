/** 制片合同的唯一 Zod schema（CodeFilm 的事实源）。
 *
 * 合同是「代码驱动生成」里 LLM 与渲染器之间的唯一契约：它是结构化数据而非自由
 * 代码，渲染后端从它编译出镜头任务。类型由 `z.output` 派生，避免两份声明漂移
 * （规范 §12 / workshop/types 的同一做法）。
 *
 * 纯逻辑、无 IO、无 Node 内建、无 server-only —— 客户端预览与服务端校验共用同一份。 */
import { z } from "zod";

import { poseKeyframeSchema } from "./action-library";

/** 世界里的一个实体（场景 / 道具 / 角色）：共享地图的条目。
 *  id 在镜头动作节拍里被引用，静态 QA 据此判引用可解析。 */
export const layoutEntitySchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["scene", "prop", "character"]),
    position: z.object({
      x: z.number(),
      y: z.number(),
      z: z.number().default(0),
    }),
    bounds: z
      .object({
        width: z.number().positive(),
        height: z.number().positive(),
      })
      .optional(),
    props: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

/** 动作节拍：镜内某一时刻某实体做的动作。
 *  t 为镜内相对秒数；actorId 必须引用 layout 中的实体（QA 校验）。
 *
 *  P2 起可引用动作库 id（`actionRef`）；`keyframes` 给自定义关键帧覆盖。
 *  两者都不给时退化为 P0 的自由文本 `action`（向后兼容旧合同）。 */
export const actionBeatSchema = z
  .object({
    action: z.string().min(1),
    /** 引用 `action-library` 里的招式 id；QA 校验可解析。 */
    actionRef: z.string().min(1).optional(),
    actorId: z.string().min(1),
    easing: z.string().optional(),
    fxRef: z.string().optional(),
    /** 自定义关键帧（覆盖动作库的默认关键帧）。 */
    keyframes: z.array(poseKeyframeSchema).optional(),
    t: z.number().nonnegative(),
    targetId: z.string().min(1).optional(),
  })
  .strict();

/** 一个镜头的完整规格。字段对齐工坊 Shot 的对外语义，另加动作编排字段。 */
export const shotSpecSchema = z
  .object({
    id: z.string().min(1),
    index: z.number().int().nonnegative(),
    sceneId: z.string().default(""),
    sceneHeading: z.string().default(""),
    shotType: z
      .enum(["extreme_wide", "wide", "full", "medium", "close", "extreme_close", "poi", "pod"])
      .default("medium"),
    description: z.string().default(""),
    characterIds: z.array(z.string()).default([]),
    duration: z.number().positive(),
    transition: z.enum(["cut", "dissolve", "fade"]).default("cut"),
    motion: z.enum(["low", "medium", "high"]).default("medium"),
    camera: z.string().default(""),
    actionBeats: z.array(actionBeatSchema).default([]),
  })
  .strict();

/** 全局时间轴的一个切片：镜头的帧偏移。 */
export const timelineSliceSchema = z
  .object({
    shotId: z.string().min(1),
    startFrame: z.number().int().nonnegative(),
    endFrame: z.number().int().positive(),
  })
  .strict()
  .refine((slice) => slice.endFrame > slice.startFrame, {
    message: "endFrame 必须大于 startFrame",
  });

/** 静态 QA 的阈值与开关。 */
export const qaRulesSchema = z
  .object({
    checkContinuity: z.boolean().default(true),
    checkDurationSum: z.boolean().default(true),
    maxShots: z.number().int().positive().default(64),
    maxFrames: z.number().int().positive().default(10_000),
  })
  .strict();

/** 制片合同顶层。renderBackend 在 P0 只接受 "comfy"，代码渲染后端 P3 才开放。 */
export const codeFilmContractSchema = z
  .object({
    meta: z
      .object({
        title: z.string().min(1),
        type: z
          .enum(["short_video", "micro_film", "animation", "ad", "comic", "other"])
          .default("animation"),
        tone: z.string().default(""),
        logline: z.string().default(""),
        fps: z.number().int().positive().default(24),
      })
      .strict(),
    layout: z.array(layoutEntitySchema).default([]),
    shots: z.array(shotSpecSchema).min(1),
    timeline: z
      .object({
        totalFrames: z.number().int().positive(),
        shots: z.array(timelineSliceSchema),
      })
      .strict(),
    qaRules: qaRulesSchema.default({
      checkContinuity: true,
      checkDurationSum: true,
      maxShots: 64,
      maxFrames: 10_000,
    }),
    renderBackend: z.enum(["comfy", "code"]).default("comfy"),
  })
  .strict();

export type LayoutEntity = z.output<typeof layoutEntitySchema>;
export type ActionBeat = z.output<typeof actionBeatSchema>;
export type ShotSpec = z.output<typeof shotSpecSchema>;
export type TimelineSlice = z.output<typeof timelineSliceSchema>;
export type QaRules = z.output<typeof qaRulesSchema>;
export type CodeFilmContract = z.output<typeof codeFilmContractSchema>;
