// 工坊草稿 → 统一生产模型写入载荷（Phase 3b-2 抽出，供工坊自动保存与画布回写共用）。
//
// meta 摊平 + 进度（阶段游标 + rendered）。这是「一份生产数据」的唯一组装口径，
// 工坊与画布两侧都经它，避免各自拼一份导致字段漂移（§12.12 去重）。纯函数、无 IO。
import { isRecord } from "~/lib/is-record";
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

// ── 机器衍生字段的保存继承（#2615）────────────────────────────
//
// 工坊草稿（shotInputSchema / characterInputSchema）不携带 production 侧的
// **机器衍生字段**——评审 / 人工裁决 / run 引擎的 rev 快照都只存在于 production
// 的记录上。自动保存把草稿 shots / characters **整列 upsert**，没有这一步继承，
// 用户在工坊里编辑任何东西的 600ms 后，评审记录、人工裁决、续跑判据一起丢
// （#2615 的现场）。规则：入参记录**缺键**的字段从库中同 id 记录继承；
// 入参显式带了值（未来草稿演进携带时）以入参为准——继承只兜「草稿不知道」，
// 不覆盖「有人明确写了」。

/** 镜头记录上的机器衍生字段（rev 快照 + 三套判定）。 */
export const SHOT_DERIVED_FIELDS = /* SAFETY: 类型断言已复核 */ [
  "rev",
  "review",
  "reviewHistory",
  "imageReview",
  "humanVerdict",
] as const;

/** 角色记录上的机器衍生字段（#2623 的人工裁决；rev 随该单补）。 */
export const CHARACTER_DERIVED_FIELDS = /* SAFETY: 类型断言已复核 */ ["humanVerdict"] as const;

/** 按同 id 继承机器衍生字段：入参缺键的位从 existing 同 id 记录取现值。
 *  纯函数、不可变；无 id 的入参记录原样保留。 */
export function inheritDerivedFields(
  incoming: Array<unknown>,
  existing: Array<unknown>,
  fields: ReadonlyArray<string>,
): Array<unknown> {
  const byId = new Map<string, Record<string, unknown>>();
  for (const raw of existing) {
    if (!isRecord(raw)) {
      continue;
    }
    const id = raw.id;
    if (typeof id === "string") {
      byId.set(id, raw);
    }
  }
  return incoming.map((raw) => {
    if (!isRecord(raw)) {
      return raw;
    }
    const id = raw.id;
    if (typeof id !== "string") {
      return raw;
    }
    const prior = byId.get(id);
    if (!prior) {
      return raw;
    }
    let next: Record<string, unknown> | null = null;
    for (const field of fields) {
      if (raw[field] !== undefined) {
        continue;
      }
      const value = prior[field];
      if (value === undefined) {
        continue;
      }
      next ??= { ...raw };
      next[field] = value;
    }
    return next ?? raw;
  });
}
