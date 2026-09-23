// 统一生产模型的「AI 评审判定」（Phase 8 · P8-1a 地基）。
//
// 背景：AI 自主流水线（剧本→角色→分镜→生图→成片）产出的内容，需要一道**机器质检**——
// 让模型对已生成的**文本内容**（分镜镜头、角色卡）给出「过 / 不过 + 具体缺陷 + 改进建议」，
// 不合格时用户可「抽卡」（同提示词换种子重出）或「改提示词重新生成」（据评审意见改写提示词再重出）。
// 视觉内容（镜头图 / 成片视频）的评审依赖多模态地基，留待后续（P8-2）；本阶段只做文本评审，
// 但判定模型保持**通用**（按记录 id 写回，不绑定具体实体），角色卡 / 视频复用同一套形状。
//
// 本文件是**纯逻辑**（无 React、无 IO，§18）：只描述判定的形状、宽容解析、以及「把判定写回某条
// 记录」的不可变 reducer。真正调模型的动作在服务端评审器里（`src/server/agent/review.ts`）。
// 判定直接挂在实体记录上（`shot.review` / `character.review`），随 `production` 的 JSON 列一起
// 持久化 —— 新增字段无需迁移（与角色定妆照 `portraits` 挂角色本身同套路）。
import { asRecord, isRecord } from "~/lib/is-record";

/** 一次评审判定：过 / 不过 + 缺陷清单 + 改进建议 + 打分时间。 */
export interface ReviewVerdict {
  /** 是否合格。false → 触发抽卡 / 改提示词重生成的入口对用户可见。 */
  pass: boolean;
  /** 逐条缺陷（人读，中文）。合格时通常为空数组。 */
  issues: string[];
  /** 改进方向（不合格时给出的一句话建议）。 */
  suggestion: string;
  /** ISO 打分时间戳。 */
  scoredAt: string;
}

/**
 * 不合格时的重生成方式（Phase 8 决策：抽卡默认「同提示词 + 换种子」，另给「改提示词」）。
 *   · gacha    —— 保留提示词，换随机种子重出一版（靠 ComfyUI 种子随机化产生差异）；
 *   · reprompt —— 据评审意见改写提示词，再重出（提示词变了 = 画面必然不同）。
 */
export type ReviewMode = "gacha" | "reprompt";

const MODES: readonly ReviewMode[] = ["gacha", "reprompt"];

/** 宽容解析重生成方式；非法/缺省回落 `gacha`（抽卡是默认动作）。 */
export function normalizeReviewMode(raw: unknown): ReviewMode {
  return MODES.includes(raw as ReviewMode) ? (raw as ReviewMode) : "gacha";
}

/**
 * 把未知值归一成 `ReviewVerdict`；缺 `pass` 布尔判据 → 视为「没有有效判定」返回 null
 * （评审是可选字段，读不到就当没评过，不硬造一个默认判定误导展示）。issues 只收非空字符串、
 * suggestion / scoredAt 缺省回落空串。不抛。
 */
export function normalizeReviewVerdict(raw: unknown): ReviewVerdict | null {
  const obj = asRecord(raw);
  if (!obj || typeof obj.pass !== "boolean") return null;
  const issues = Array.isArray(obj.issues)
    ? obj.issues
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item !== "")
    : [];
  return {
    pass: obj.pass,
    issues,
    suggestion: typeof obj.suggestion === "string" ? obj.suggestion : "",
    scoredAt: typeof obj.scoredAt === "string" ? obj.scoredAt : "",
  };
}

/** 读某条记录（分镜镜头 / 角色卡的未知记录）上已存的评审判定；没评过 → null。 */
export function getRecordReview(raw: unknown): ReviewVerdict | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  return normalizeReviewVerdict(rec.review);
}

/**
 * 把评审判定写回一批记录里 `id` 命中的那条（不可变返回新数组）。作用于 `production.shots` /
 * `production.characters` 这类 unknown 记录数组 —— 与 `applyShotRedo` 同口径：认 id、不认具体
 * 实体类型，因此镜头与角色卡共用一个 reducer。无命中 → 原样返回入参引用（调用方据此判断
 * 「找不到目标、无需落库」）。
 */
export function applyReview(
  entities: unknown[],
  id: string,
  verdict: ReviewVerdict,
): unknown[] {
  let hit = false;
  const next = entities.map((raw) => {
    if (!isRecord(raw) || raw.id !== id) return raw;
    hit = true;
    return { ...raw, review: verdict };
  });
  return hit ? next : entities;
}
