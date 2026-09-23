// 服务端 AI 评审执行器（Phase 8 · P8-1a）。
//
// 消费 P8-1a 的判定模型（`review-types`）与提示词构建器（`llm/prompts`），把「让模型对已生成的
// 文本内容（分镜镜头 / 角色卡）给一份过/不过判定」落成一次可测的服务端调用：读 `production` →
// 提炼待评审文本 → 结构化补全 → 归一判定 → 写回实体记录（`shot.review` / `character.review`）。
// 不合格时的重生成动作也在这里落地：
//   · gacha（抽卡）  —— 保留提示词，走 `applyShotRedo`（清产物 + rev 自增）让规划器重新纳入、换种子重出；
//   · reprompt（改提示词）—— 先让模型据评审意见产出改进提示词，再 `applyReprompt`（换 prompt + 退回）。
//
// 只写内容列（`patchContent`），不碰 run / progress —— 字段所有权：评审改的是镜头/角色内容，
// run 仍由控制端点写。视觉内容（镜头图 / 成片）评审依赖多模态地基，留待后续（P8-2）。
import "server-only";

import { z } from "zod";

import { productionRepository } from "~/lib/core/repository-production";
import { asRecord } from "~/lib/is-record";
import { completeLLMStructured, getLLMConfig } from "~/lib/llm/server";
import {
  buildReviewMessages,
  buildShotRepromptMessages,
  type ContentReviewContext,
} from "~/lib/llm/prompts";
import {
  applyReview,
  type ReviewMode,
  type ReviewVerdict,
} from "~/lib/production/review-types";
import { applyReprompt, applyShotRedo } from "~/lib/production/sync";
import type { Production } from "~/server/db/schema";

/** 评审目标实体类型。文本评审当前覆盖镜头（分镜）与角色卡。 */
export type ReviewKind = "shot" | "character";

const KIND_LABEL: Record<ReviewKind, string> = {
  shot: "分镜镜头",
  character: "角色卡",
};

/** 模型评审输出：`issues` / `suggestion` 容忍缺省（部分模型会漏字段）。 */
const VERDICT_SCHEMA = z.object({
  pass: z.boolean(),
  issues: z.array(z.string()).default([]),
  suggestion: z.string().default(""),
});

/** reprompt 输出：改进后的镜头提示词。 */
const REPROMPT_SCHEMA = z.object({ prompt: z.string() });

const SCRIPT_EXCERPT_MAX = 4000;
const nowIso = () => new Date().toISOString();

function str(rec: Record<string, unknown>, key: string): string {
  const v = rec[key];
  return typeof v === "string" ? v : "";
}

/** 创作上下文（判一致性用）：项目元信息 + 剧本节选（裁长防超窗）。 */
function reviewContext(row: Production): ContentReviewContext {
  return {
    title: row.title,
    type: row.type,
    tone: row.tone,
    logline: row.logline,
    scriptExcerpt: row.scriptMarkdown.slice(0, SCRIPT_EXCERPT_MAX),
  };
}

/** 从镜头记录提炼可评审文本（景别 / 场景 / 画面 / 提示词）。 */
function shotReviewText(rec: Record<string, unknown>): string {
  // 镜号是数字：只在它是 number/string 基元时拼进模板，避免对 unknown 做隐式字符串化。
  const indexText =
    typeof rec.index === "number" || typeof rec.index === "string"
      ? `镜号 ${rec.index}`
      : "";
  const parts = [
    indexText,
    str(rec, "sceneHeading") ? `场景：${str(rec, "sceneHeading")}` : "",
    str(rec, "shotType") ? `景别：${str(rec, "shotType")}` : "",
    str(rec, "description") ? `画面：${str(rec, "description")}` : "",
    str(rec, "prompt") ? `提示词：${str(rec, "prompt")}` : "",
  ];
  return parts.filter(Boolean).join("\n") || "（空镜头）";
}

/** 从角色记录提炼可评审文本（名字 / 外貌 / 服装 / 性格）。 */
function characterReviewText(rec: Record<string, unknown>): string {
  const parts = [
    str(rec, "name") ? `名字：${str(rec, "name")}` : "",
    str(rec, "appearance") ? `外貌：${str(rec, "appearance")}` : "",
    str(rec, "costume") ? `服装：${str(rec, "costume")}` : "",
    str(rec, "personality") ? `性格：${str(rec, "personality")}` : "",
  ];
  return parts.filter(Boolean).join("\n") || "（空角色卡）";
}

function reviewTextOf(kind: ReviewKind, rec: Record<string, unknown>): string {
  return kind === "shot" ? shotReviewText(rec) : characterReviewText(rec);
}

function listForKind(row: Production, kind: ReviewKind): unknown[] {
  const raw = kind === "shot" ? row.shots : row.characters;
  return Array.isArray(raw) ? raw : [];
}

/** 在记录数组里按 id 找到目标记录（宽松对象视图）；找不到 → null。 */
function findRecord(
  list: unknown[],
  id: string,
): Record<string, unknown> | null {
  for (const raw of list) {
    const rec = asRecord(raw);
    if (rec?.id === id) return rec;
  }
  return null;
}

async function loadRow(userId: string, projectId: string): Promise<Production> {
  const row = await productionRepository.getForUser(userId, projectId);
  if (!row) throw new Error("该项目还没有生产数据（先在工坊产出内容再评审）");
  return row;
}

/**
 * 评审一条内容（分镜镜头 / 角色卡）：调模型给判定 → 归一 → 写回 `entity.review` → 返回。
 * 目标 id 不存在时抛可行动错误（不静默，避免「点了评审但内容没评」）。
 */
export async function reviewContent(
  userId: string,
  projectId: string,
  kind: ReviewKind,
  targetId: string,
): Promise<ReviewVerdict> {
  const row = await loadRow(userId, projectId);
  const list = listForKind(row, kind);
  const rec = findRecord(list, targetId);
  if (!rec)
    throw new Error(`找不到要评审的${KIND_LABEL[kind]}（id=${targetId}）`);

  const cfg = await getLLMConfig();
  const raw = await completeLLMStructured(
    cfg,
    buildReviewMessages(
      KIND_LABEL[kind],
      reviewTextOf(kind, rec),
      reviewContext(row),
    ),
    VERDICT_SCHEMA,
  );
  const verdict: ReviewVerdict = {
    pass: raw.pass,
    issues: raw.issues,
    suggestion: raw.suggestion,
    scoredAt: nowIso(),
  };
  const nextList = applyReview(list, targetId, verdict);
  await productionRepository.patchContent(
    userId,
    projectId,
    kind === "shot" ? { shots: nextList } : { characters: nextList },
  );
  return verdict;
}

/**
 * 评审不合格后的重生成动作（镜头）：
 *   · gacha    —— `applyShotRedo`：保留提示词，清产物 + rev 自增 → 规划器重新纳入、换种子重出；
 *   · reprompt —— 未显式给 `newPrompt` 时先让模型据评审意见产出改进提示词，再 `applyReprompt`
 *                 （换 prompt + 退回重做）。
 * 只写内容列。镜头不存在 / 无评审意见可依据（reprompt 但记录上没 review）时按情况处理：reprompt
 * 无 newPrompt 且无已存判定 → 用记录当前文本 + 空意见仍产出改写（不阻断），保持动作始终可用。
 */
export async function regenerateShot(
  userId: string,
  projectId: string,
  shotId: string,
  mode: ReviewMode,
  newPrompt?: string,
): Promise<void> {
  const row = await loadRow(userId, projectId);
  const shots = listForKind(row, "shot");
  const rec = findRecord(shots, shotId);
  if (!rec) throw new Error(`找不到要重生成的镜头（id=${shotId}）`);

  if (mode === "gacha") {
    await productionRepository.patchContent(userId, projectId, {
      shots: applyShotRedo(shots, shotId),
    });
    return;
  }

  // reprompt：优先用调用方给的提示词；否则让模型据评审意见改写。
  const finalPrompt = newPrompt?.trim()
    ? newPrompt.trim()
    : await revisePrompt(row, rec);
  await productionRepository.patchContent(userId, projectId, {
    shots: applyReprompt(shots, shotId, finalPrompt),
  });
}

/** 据镜头上已存的评审判定（或空意见）让模型产出一版改进提示词。 */
async function revisePrompt(
  row: Production,
  rec: Record<string, unknown>,
): Promise<string> {
  const review = asRecord(rec.review);
  const issues = Array.isArray(review?.issues)
    ? review.issues.filter((x): x is string => typeof x === "string")
    : [];
  const suggestion =
    review && typeof review.suggestion === "string" ? review.suggestion : "";
  const cfg = await getLLMConfig();
  const { prompt } = await completeLLMStructured(
    cfg,
    buildShotRepromptMessages(
      str(rec, "prompt") || str(rec, "description"),
      { issues, suggestion },
      reviewContext(row),
    ),
    REPROMPT_SCHEMA,
  );
  const trimmed = prompt.trim();
  // 模型空返回时兜底回原提示词，避免把镜头提示词抹空（退回语义已由 applyReprompt 负责）。
  return trimmed || str(rec, "prompt") || str(rec, "description");
}
