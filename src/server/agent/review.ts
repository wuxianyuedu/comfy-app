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

import { taskRepository } from "~/lib/core/repository";
import { productionRepository } from "~/lib/core/repository-production";
import { asRecord } from "~/lib/is-record";
import {
  completeLLM,
  completeLLMStructured,
  getLLMConfig,
  getVisionLLMConfig,
} from "~/lib/llm/server";
import {
  buildReviewMessages,
  buildScriptReviewMessages,
  buildScriptRevisionMessages,
  buildShotImageReviewMessages,
  buildShotRepromptMessages,
  type ContentReviewContext,
} from "~/lib/llm/prompts";
import {
  applyImageReview,
  applyReview,
  applyScriptReview,
  normalizeReviewVerdict,
  normalizeScriptReviewState,
  recordScriptRevision,
  reviewScoreMean,
  weakScoreEntries,
  type ReviewMode,
  type ReviewVerdict,
} from "~/lib/production/review-types";
import { renderRubricForPrompt, rubricFor } from "~/lib/production/review-rubrics";
import { applyReprompt, applyShotRedo } from "~/lib/production/sync";
import type { Production } from "~/server/db/schema";

/** 评审目标实体类型。文本评审当前覆盖镜头（分镜）与角色卡。 */
export type ReviewKind = "shot" | "character";

/** 一次剧本评审的产出：判定 + 完整分数曲线（旧→新，含本轮；FR-QA-07「每轮分数可回看」）。 */
export type ScriptReviewOutcome = {
  history: Array<ReviewVerdict>;
  verdict: ReviewVerdict;
};

const KIND_LABEL: Record<ReviewKind, string> = {
  shot: "分镜镜头",
  character: "角色卡",
};

/** 模型评审输出：`issues` / `suggestion` 容忍缺省（部分模型会漏字段）；
 *  `scores` 是维度评分（FR-QA-07，rubric 在提示词里给了锚点才要求）——模型漏给时
 *  仍是有效判定（scores 缺省 undefined = 未评分），单维度畸形分由归一层夹取。 */
const VERDICT_SCHEMA = z.object({
  pass: z.boolean(),
  issues: z.array(z.string()).default([]),
  suggestion: z.string().default(""),
  scores: z
    .record(z.string(), z.object({ score: z.number(), note: z.string().default("") }))
    .optional(),
});

/** reprompt 输出：改进后的镜头提示词。 */
const REPROMPT_SCHEMA = z.object({ prompt: z.string() });

const SCRIPT_EXCERPT_MAX = 4000;
/** 剧本评审时送进模型的整份剧本上限（剧本本身是评审对象，比一致性节选放宽一倍）。 */
const SCRIPT_REVIEW_MAX = 8000;
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
    typeof rec.index === "number" || typeof rec.index === "string" ? `镜号 ${rec.index}` : "";
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

function listForKind(row: Production, kind: ReviewKind): Array<unknown> {
  const raw = kind === "shot" ? row.shots : row.characters;
  return Array.isArray(raw) ? raw : [];
}

/** 在记录数组里按 id 找到目标记录（宽松对象视图）；找不到 → null。 */
function findRecord(list: Array<unknown>, id: string): Record<string, unknown> | null {
  for (const raw of list) {
    const rec = asRecord(raw);
    if (rec?.id === id) {
      return rec;
    }
  }
  return null;
}

async function loadRow(userId: string, projectId: string): Promise<Production> {
  const row = await productionRepository.getForUser(userId, projectId);
  if (!row) {
    throw new Error("该项目还没有生产数据（先在工坊产出内容再评审）");
  }
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
  if (!rec) {
    throw new Error(`找不到要评审的${KIND_LABEL[kind]}（id=${targetId}）`);
  }

  const cfg = await getLLMConfig({ taskType: "review" });
  // 评审温度走 temperatureByTask 的 review 档（FR-QA-07 ③）：用户覆盖 → review 推荐
  // 默认（0.1）→ 全局。判定类任务要低温可复现，不再吃全局温度。
  const rubric = rubricFor(kind);
  const raw = await completeLLMStructured(
    cfg,
    buildReviewMessages(
      KIND_LABEL[kind],
      reviewTextOf(kind, rec),
      reviewContext(row),
      rubric ? renderRubricForPrompt(rubric) : undefined,
    ),
    VERDICT_SCHEMA,
  );
  // scores 畸形分夹取复用归一层；rubricVersion 记「打分那一刻的量表版本」。
  const verdict = normalizeReviewVerdict({
    pass: raw.pass,
    issues: raw.issues,
    suggestion: raw.suggestion,
    scoredAt: nowIso(),
    ...(raw.scores ? { scores: raw.scores } : {}),
    ...(rubric ? { rubricVersion: rubric.version } : {}),
  });
  if (!verdict) {
    throw new Error("模型评审返回缺 pass 判据（无法归一成判定）");
  }
  const nextList = applyReview(list, targetId, verdict);
  await productionRepository.patchContent(
    userId,
    projectId,
    kind === "shot" ? { shots: nextList } : { characters: nextList },
  );
  return verdict;
}

/**
 * 视觉评审一条镜头的**生图**（P8-2 多模态评审）：看图 + 该镜出场角色定妆照，按生图
 * rubric（与提示词对齐 / 角色一致性 / 构图景别 / 画面瑕疵）打分，判定写回 `shot.imageReview`
 * （与文本 `shot.review` 分开存，互不打扰）。输入 = 产物图 + 提示词 + 定妆照 + 景别设定。
 * 没图 / 找不到镜头 → 抛可行动错误（不静默）。
 */
/**
 * 评审内核（#2612 自动优选抽出）：给定镜头上下文与**任意一张**图 → 判定。
 * 无写副作用——调用方决定判定落到哪（原入口写 `shot.imageReview`，优选只取分）。
 */
async function scoreShotImage(
  row: Production,
  rec: Record<string, unknown>,
  imageUrl: string,
): Promise<ReviewVerdict> {
  // 出场角色的生效定妆照（角色一致性对照用）。
  /* SAFETY: 类型断言已复核 */
  const characterIds = Array.isArray(rec.characterIds)
    ? (rec.characterIds as Array<unknown>).filter((x): x is string => typeof x === "string")
    : [];
  const characters = Array.isArray(row.characters) ? row.characters : [];
  const portraitUrls: Array<string> = [];
  const characterNames: Array<string> = [];
  for (const raw of characters) {
    const c = asRecord(raw);
    if (!c || !characterIds.includes(String(c.id))) {
      continue;
    }
    if (typeof c.portraitUrl === "string" && c.portraitUrl.trim() !== "") {
      portraitUrls.push(c.portraitUrl);
    }
    if (typeof c.name === "string" && c.name.trim() !== "") {
      characterNames.push(c.name);
    }
  }

  const cfg = await getVisionLLMConfig({ taskType: "review" });
  const rubric = rubricFor("shotImage");
  const raw = await completeLLMStructured(
    cfg,
    buildShotImageReviewMessages(
      {
        imageUrl,
        portraitUrls,
        prompt: str(rec, "prompt") || str(rec, "description"),
        shotType: str(rec, "shotType"),
        characterNames,
      },
      rubric ? renderRubricForPrompt(rubric) : undefined,
    ),
    VERDICT_SCHEMA,
  );
  const verdict = normalizeReviewVerdict({
    pass: raw.pass,
    issues: raw.issues,
    suggestion: raw.suggestion,
    scoredAt: nowIso(),
    ...(raw.scores ? { scores: raw.scores } : {}),
    ...(rubric ? { rubricVersion: rubric.version } : {}),
  });
  if (!verdict) {
    throw new Error("模型视觉评审返回缺 pass 判据（无法归一成判定）");
  }
  return verdict;
}

export async function reviewShotImage(
  userId: string,
  projectId: string,
  shotId: string,
): Promise<ReviewVerdict> {
  const row = await loadRow(userId, projectId);
  const shots = listForKind(row, "shot");
  const rec = findRecord(shots, shotId);
  if (!rec) {
    throw new Error(`找不到要评审的镜头（id=${shotId}）`);
  }
  const imageUrl = str(rec, "imageUrl");
  if (!imageUrl.trim()) {
    throw new Error("该镜头还没有生成图（先在工坊生图，再视觉评审）");
  }

  const verdict = await scoreShotImage(row, rec, imageUrl);
  const nextShots = applyImageReview(shots, shotId, verdict);
  await productionRepository.patchContent(userId, projectId, {
    shots: nextShots,
  });
  return verdict;
}

// ── 自动优选：抽卡 N 选 1（FR-QA-04④ · #2612）──────────────────

/** 单个候选的评分记录；verdict 为 null = 该候选没有产物可评（跳过）。 */
export type AutoselectCandidate = {
  imageUrl: string | null;
  taskId: string;
  verdict: ReviewVerdict | null;
};

export type AutoselectResult = {
  candidates: Array<AutoselectCandidate>;
  winnerImageUrl: string;
  winnerTaskId: string;
  winnerVerdict: ReviewVerdict;
};

/**
 * 抽卡优选：对同一镜头的 2~4 个候选任务逐张打分（评审内核），均分最高者为
 * 赢家（平分取提交序在先者）。**不写 production**——赢家 imageUrl / taskId 由
 * 客户端经镜头草稿回写（草稿自动保存是镜头内容真值，服务端直写会被反向覆盖）；
 * 赢家判定另经 `applyImageReview` 落 `shot.imageReview`（与原入口同一落点、
 * 同受 #2615 记录的工坊覆盖隐患约束）。
 */
export async function autoselectShotImage(
  userId: string,
  projectId: string,
  shotId: string,
  taskIds: Array<string>,
): Promise<AutoselectResult> {
  if (taskIds.length < 2 || taskIds.length > 4) {
    throw new Error("抽卡候选数量须在 2~4 张");
  }
  const row = await loadRow(userId, projectId);
  const shots = listForKind(row, "shot");
  const rec = findRecord(shots, shotId);
  if (!rec) {
    throw new Error(`找不到要优选的镜头（id=${shotId}）`);
  }

  const seen = new Set<string>();
  const candidates: Array<AutoselectCandidate> = [];
  for (const taskId of taskIds) {
    if (seen.has(taskId)) {
      continue;
    }
    seen.add(taskId);
    const task = await taskRepository.findByIdWithImages(taskId);
    /* 等价形态：`userId` 是必填 string，不存在「task 为 null 而 userId 也是
     * undefined」那一支（`prefer-optional-chain` 要的就是这一句）。 */
    if (task?.userId !== userId) {
      throw new Error(`候选任务不存在或不属于当前用户：${taskId}`);
    }
    const image = task.images.find((i) => i.isCover) ?? task.images[0];
    if (!image) {
      candidates.push({ taskId, imageUrl: null, verdict: null });
      continue;
    }
    const verdict = await scoreShotImage(row, rec, image.localPath);
    candidates.push({ taskId, imageUrl: image.localPath, verdict });
  }
  // 判定与图地址在同一步收窄（predicate），后续消费点不再需要非空断言。
  const scored = candidates.filter(
    (
      c,
    ): c is AutoselectCandidate & {
      imageUrl: string;
      verdict: ReviewVerdict;
    } => c.verdict !== null && c.imageUrl !== null,
  );
  if (scored.length === 0) {
    throw new Error("所有候选都没有产物可评审（先生成，再优选）");
  }
  const winner = scored.reduce((best, c) =>
    (reviewScoreMean(c.verdict) ?? 0) > (reviewScoreMean(best.verdict) ?? 0) ? c : best,
  );
  // 赢家判定落到镜头（与 reviewShotImage 同一落点；字段所有权见 #2615）。
  const nextShots = applyImageReview(shots, shotId, winner.verdict);
  await productionRepository.patchContent(userId, projectId, {
    shots: nextShots,
  });
  return {
    winnerTaskId: winner.taskId,
    winnerImageUrl: winner.imageUrl,
    winnerVerdict: winner.verdict,
    candidates,
  };
}

/**
 * 评审整份剧本（FR-QA-07 ② · #2477 地基）：调模型给判定 → 写回 `production.scriptReview`
 * 列（含轮次历史，`applyScriptReview`）→ 返回判定与完整分数曲线（`[...history, review]`，
 * 供 UI「每轮分数可回看」）。剧本是项目级内容，没有实体 id；路由形态见 `run.reviewScript`。
 */
export async function reviewScript(
  userId: string,
  projectId: string,
): Promise<ScriptReviewOutcome> {
  const row = await loadRow(userId, projectId);
  if (!row.scriptMarkdown.trim()) {
    throw new Error("该项目还没有剧本（先在工坊产出剧本再评审）");
  }

  const cfg = await getLLMConfig({ taskType: "review" });
  const rubric = rubricFor("script");
  const raw = await completeLLMStructured(
    cfg,
    buildScriptReviewMessages(
      row.scriptMarkdown.slice(0, SCRIPT_REVIEW_MAX),
      // 剧本本身就是评审对象：上下文里不再带剧本节选（避免同一段文本进两遍）。
      { ...reviewContext(row), scriptExcerpt: "" },
      rubric ? renderRubricForPrompt(rubric) : undefined,
    ),
    VERDICT_SCHEMA,
  );
  const verdict = normalizeReviewVerdict({
    pass: raw.pass,
    issues: raw.issues,
    suggestion: raw.suggestion,
    scoredAt: nowIso(),
    ...(raw.scores ? { scores: raw.scores } : {}),
    ...(rubric ? { rubricVersion: rubric.version } : {}),
  });
  if (!verdict) {
    throw new Error("模型评审返回缺 pass 判据（无法归一成判定）");
  }

  const next = applyScriptReview(row.scriptReview, verdict);
  await productionRepository.patchContent(userId, projectId, {
    scriptReview: next,
  });
  return {
    verdict,
    history: [...next.history, next.review ?? verdict],
  };
}

/**
 * 按评审判定**定向改写**剧本（FR-QA-07 ④ · #2478）：消费上一轮评审的低分维度与逐条缺陷，
 * 让模型产出一版改进后的完整剧本；改写前的旧版本压进 `scriptReview.revisions` 留档
 * （人可回看/接管，AI 下一轮从人改的版本继续）。没有可依据的评审位（没评过）时拒改——
 * 定向改写的「定向」来自评审意见，凭空改 = 退化成整篇重生成。
 */
export async function reviseScript(userId: string, projectId: string): Promise<string> {
  const row = await loadRow(userId, projectId);
  if (!row.scriptMarkdown.trim()) {
    throw new Error("该项目还没有剧本（先在工坊产出剧本再改写）");
  }
  const state = normalizeScriptReviewState(row.scriptReview);
  if (!state.review) {
    throw new Error("这份剧本还没有评审判定（先评审、拿到低分维度再定向改写）");
  }

  const cfg = await getLLMConfig({ taskType: "review" });
  const md = (
    await completeLLM(
      cfg,
      buildScriptRevisionMessages(
        row.scriptMarkdown.slice(0, SCRIPT_REVIEW_MAX),
        {
          issues: state.review.issues,
          suggestion: state.review.suggestion,
          lowScores: weakScoreEntries(state.review),
        },
        { ...reviewContext(row), scriptExcerpt: "" },
      ),
    )
  ).trim();
  if (!md) {
    throw new Error("模型未返回改写后的剧本（保留原剧本，可重试）");
  }

  await productionRepository.patchContent(userId, projectId, {
    scriptMarkdown: md,
    scriptReview: recordScriptRevision(row.scriptReview, row.scriptMarkdown, nowIso()),
  });
  return md;
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
  if (!rec) {
    throw new Error(`找不到要重生成的镜头（id=${shotId}）`);
  }

  if (mode === "gacha") {
    await productionRepository.patchContent(userId, projectId, {
      shots: applyShotRedo(shots, shotId),
    });
    return;
  }

  // reprompt：优先用调用方给的提示词；否则让模型据评审意见改写。
  const trimmedPrompt = newPrompt?.trim();
  const finalPrompt =
    trimmedPrompt !== undefined && trimmedPrompt !== ""
      ? trimmedPrompt
      : await revisePrompt(row, rec);
  await productionRepository.patchContent(userId, projectId, {
    shots: applyReprompt(shots, shotId, finalPrompt),
  });
}

/** 据镜头上已存的评审判定（或空意见）让模型产出一版改进提示词。 */
async function revisePrompt(row: Production, rec: Record<string, unknown>): Promise<string> {
  const review = asRecord(rec.review);
  const issues = Array.isArray(review?.issues)
    ? review.issues.filter((x): x is string => typeof x === "string")
    : [];
  const suggestion = review && typeof review.suggestion === "string" ? review.suggestion : "";
  const cfg = await getLLMConfig({ taskType: "review" });
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
