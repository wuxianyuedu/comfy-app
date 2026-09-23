// 统一生产模型的「完成状态」单一来源（Phase 4 / 设计 §7）。
//
// 此前完成态散在三处：工坊阶段游标（tab）与 rendered 只是 React state（刷新即丢）、
// filmProject.status/progress、workshopSession.stage。P4 第一步把「阶段游标 + rendered」
// 收敛成一份 ProductionProgress，落在 production 行的 progress 列（JSON，已存在），
// 由工坊与画布共读同一份、刷新不丢。阶段词表在这里**定义一次**（§12.14 默认值/枚举不得
// 各处硬编码），工坊 stage-config 的 Tab 从这里派生，避免两套漂移。纯函数、无 IO、无 React。
import { isRecord } from "~/lib/is-record";

/** 生产阶段游标的全部取值（与工坊阶段导航一一对应；done 由 rendered=true 表达）。 */
export const PRODUCTION_STAGES = [
  "script",
  "character",
  "storyboard",
  "shots",
  "video",
  "render",
] as const;

export type ProductionStage = (typeof PRODUCTION_STAGES)[number];

export function isProductionStage(value: unknown): value is ProductionStage {
  return (
    typeof value === "string" &&
    (PRODUCTION_STAGES as readonly string[]).includes(value)
  );
}

/** 完成状态：阶段游标 + 成片是否已导出/合成（持久化，修工坊 rendered 只在 React state）。 */
export interface ProductionProgress {
  stage: ProductionStage;
  rendered: boolean;
}

export const DEFAULT_PRODUCTION_PROGRESS: ProductionProgress = {
  stage: "script",
  rendered: false,
};

/** 未知值（production 表的 progress JSON 列）→ 规范化的 ProductionProgress。
 *  非法 / 缺字段回落默认，不抛——读侧对脏数据宽容。 */
export function normalizeProductionProgress(raw: unknown): ProductionProgress {
  if (!isRecord(raw)) return { ...DEFAULT_PRODUCTION_PROGRESS };
  return {
    stage: isProductionStage(raw.stage) ? raw.stage : "script",
    rendered: raw.rendered === true,
  };
}
