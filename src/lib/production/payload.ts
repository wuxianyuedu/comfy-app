// 工坊草稿 → 统一生产模型写入载荷（Phase 3b-2 抽出，供工坊自动保存与画布回写共用）。
//
// meta 摊平 + 进度（阶段游标 + rendered）。这是「一份生产数据」的唯一组装口径，
// 工坊与画布两侧都经它，避免各自拼一份导致字段漂移（§12.12 去重）。纯函数、无 IO。
import type { ProductionPayload } from "~/lib/production/production-client";
import type { ProductionStage } from "~/lib/production/progress";
import type { WorkshopDraft } from "~/lib/workshop/draft-store";

/** 工坊草稿 → 生产数据写入载荷（字段与 production 表列一一对应）。 */
export function buildProductionPayload(
  draft: WorkshopDraft,
  stage: ProductionStage,
  rendered: boolean,
): ProductionPayload {
  return {
    title: draft.meta.title,
    type: draft.meta.type,
    tone: draft.meta.tone,
    logline: draft.meta.logline,
    scriptMarkdown: draft.scriptMarkdown,
    scenes: draft.scenes,
    characters: draft.characters,
    shots: draft.shots,
    progress: { stage, rendered },
  };
}
