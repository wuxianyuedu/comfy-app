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
import { tailWindow } from "~/lib/page-window";
import { clamp } from "~/lib/clamp";

/** 单个维度的评分：1~5 分 + 一句话依据（人读，中文）。 */
export interface ReviewScore {
  /** 维度分（1~5，越界在归一时夹取）。 */
  score: number;
  /** 打这个分的一句话依据；模型漏给时为空串。 */
  note: string;
}

/** 一次评审判定：过 / 不过 + 缺陷清单 + 改进建议 + 维度评分 + 打分时间。 */
export interface ReviewVerdict {
  /** 是否合格。false → 触发抽卡 / 改提示词重生成的入口对用户可见。 */
  pass: boolean;
  /** 逐条缺陷（人读，中文）。合格时通常为空数组。 */
  issues: Array<string>;
  /** 改进方向（不合格时给出的一句话建议）。 */
  suggestion: string;
  /** ISO 打分时间戳。 */
  scoredAt: string;
  /**
   * 维度评分（FR-QA-07 地基）：rubric 维度 key → 分 + 依据。**可选**——P8-1a 时代的
   * 旧判定没有这层，读作「未评分」，不硬造分数；新判定按 rubric（`review-rubrics.ts`）
   * 给出。分数与 `pass` 判定相互独立：低分但勉强可用可以 pass=true。
   */
  scores?: Record<string, ReviewScore>;
  /** 评分所用的 rubric 版本（口径演进后旧分数仍可解释）；未评分时缺省。 */
  rubricVersion?: string;
}

/** 实体上保留的历次判定上限（`reviewHistory` 只存**本轮之前**的判定；当前判定在 `review`）。 */
export const REVIEW_HISTORY_LIMIT = 9;

/**
 * 剧本改写前留档的旧版本上限（FR-QA-07 ④ · #2478）：`scriptReview.revisions` 只保留
 * 最近 N 次改写前的剧本全文 —— 人可随时回看/接管，AI 下一轮从人改的版本继续。
 * 剧本全文很占列宽，上限取小（3 份）。
 */
export const SCRIPT_REVISION_LIMIT = 3;

/**
 * 不合格时的重生成方式（Phase 8 决策：抽卡默认「同提示词 + 换种子」，另给「改提示词」）。
 *   · gacha    —— 保留提示词，换随机种子重出一版（靠 ComfyUI 种子随机化产生差异）；
 *   · reprompt —— 据评审意见改写提示词，再重出（提示词变了 = 画面必然不同）。
 */
export type ReviewMode = "gacha" | "reprompt";

const MODES: ReadonlyArray<ReviewMode> = ["gacha", "reprompt"];

/** 宽容解析重生成方式；非法/缺省回落 `gacha`（抽卡是默认动作）。 */
export function normalizeReviewMode(raw: unknown): ReviewMode {
  /* SAFETY: 类型断言已复核 */
  return MODES.includes(/* SAFETY: 类型断言已复核 */ raw as ReviewMode)
    ? (raw as ReviewMode)
    : "gacha";
}

/**
 * 宽容解析维度评分（未知 JSON → `Record<string, ReviewScore>`）：只收「有限数字分 +
 * 可缺省依据」的条目，分越界夹取到 1~5、key 去空白后非空；非法条目丢弃，不抛。
 * 返回 undefined = 入参里没有可用的 scores（旧数据 / 模型没给）。
 */
function normalizeScores(raw: unknown): Record<string, ReviewScore> | undefined {
  const obj = asRecord(raw);
  if (!obj) {
    return undefined;
  }
  const out: Record<string, ReviewScore> = {};
  for (const [key, value] of Object.entries(obj)) {
    const trimmedKey = key.trim();
    const item = asRecord(value);
    if (!item || trimmedKey === "") {
      continue;
    }
    if (typeof item.score !== "number" || !Number.isFinite(item.score)) {
      continue;
    }
    out[trimmedKey] = {
      score: clamp(item.score, 1, 5),
      note: typeof item.note === "string" ? item.note.trim() : "",
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * 把未知值归一成 `ReviewVerdict`；缺 `pass` 布尔判据 → 视为「没有有效判定」返回 null
 * （评审是可选字段，读不到就当没评过，不硬造一个默认判定误导展示）。issues 只收非空字符串、
 * suggestion / scoredAt 缺省回落空串；scores / rubricVersion 有合法值才挂键（旧数据
 * 读作「未评分」）。不抛。
 */
export function normalizeReviewVerdict(raw: unknown): ReviewVerdict | null {
  const obj = asRecord(raw);
  if (!obj || typeof obj.pass !== "boolean") {
    return null;
  }
  const issues = Array.isArray(obj.issues)
    ? obj.issues
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item !== "")
    : [];
  const scores = normalizeScores(obj.scores);
  return {
    pass: obj.pass,
    issues,
    suggestion: typeof obj.suggestion === "string" ? obj.suggestion : "",
    scoredAt: typeof obj.scoredAt === "string" ? obj.scoredAt : "",
    ...(scores ? { scores } : {}),
    ...(typeof obj.rubricVersion === "string" && obj.rubricVersion.trim() !== ""
      ? { rubricVersion: obj.rubricVersion }
      : {}),
  };
}

/** 维度均分（收敛判据的输入）；未评分 / 无有效维度 → null（调用方据此走「不过」旧路）。 */
export function reviewScoreMean(verdict: ReviewVerdict): number | null {
  const scores = verdict.scores;
  if (!scores) {
    return null;
  }
  const values = Object.values(scores).map((item) => item.score);
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** 读某条记录（分镜镜头 / 角色卡的未知记录）上已存的评审判定；没评过 → null。 */
export function getRecordReview(raw: unknown): ReviewVerdict | null {
  const rec = asRecord(raw);
  if (!rec) {
    return null;
  }
  return normalizeReviewVerdict(rec.review);
}

/**
 * 读某条记录上已存的**视觉**评审判定（P8-2 生图评审，挂在 `imageReview`，与文本
 * `review` 分开存）；没评过 → null。两者独立：文本评提示词、视觉评图，互不打扰。
 */
export function getRecordImageReview(raw: unknown): ReviewVerdict | null {
  const rec = asRecord(raw);
  if (!rec) {
    return null;
  }
  return normalizeReviewVerdict(rec.imageReview);
}

/**
 * 把视觉评审判定写回一批记录里 `id` 命中的那条（不可变返回新数组）。与 `applyReview`
 * 同口径：认 id、不认具体实体类型（P8-2 只用于镜头，但 reducer 保持通用）。
 * 无命中 → 原样返回入参引用。只动 `imageReview`，不动 `review` / `reviewHistory`。
 */
export function applyImageReview(
  entities: Array<unknown>,
  id: string,
  verdict: ReviewVerdict,
): Array<unknown> {
  let hit = false;
  const next = entities.map((raw) => {
    if (!isRecord(raw) || raw.id !== id) {
      return raw;
    }
    hit = true;
    return { ...raw, imageReview: verdict };
  });
  return hit ? next : entities;
}

/**
 * 把评审判定写回一批记录里 `id` 命中的那条（不可变返回新数组）。作用于 `production.shots` /
 * `production.characters` 这类 unknown 记录数组 —— 与 `applyShotRedo` 同口径：认 id、不认具体
 * 实体类型，因此镜头与角色卡共用一个 reducer。无命中 → 原样返回入参引用（调用方据此判断
 * 「找不到目标、无需落库」）。
 *
 * 同时维护轮次历史（FR-QA-07：每轮分数落库留痕）：记录上**已有的**有效判定进
 * `reviewHistory`（尾部追加、超上限从头裁剪），当前判定始终在 `review` ——
 * 曲线 = `[...reviewHistory, review]`。旧判定无效（缺 pass）时不往历史塞垃圾。
 */
export function applyReview(
  entities: Array<unknown>,
  id: string,
  verdict: ReviewVerdict,
): Array<unknown> {
  let hit = false;
  const next = entities.map((raw) => {
    if (!isRecord(raw) || raw.id !== id) {
      return raw;
    }
    hit = true;
    // Array.isArray 把 unknown 收窄成 any[]：显式标 unknown[] 再展开，避免 any 混入数组。
    /* SAFETY: 类型断言已复核 */
    const prevHistory: Array<unknown> = Array.isArray(raw.reviewHistory)
      ? (raw.reviewHistory as Array<unknown>)
      : [];
    const prevVerdict = normalizeReviewVerdict(raw.review);
    const history = prevVerdict
      ? tailWindow([...prevHistory, prevVerdict], REVIEW_HISTORY_LIMIT)
      : prevHistory;
    return {
      ...raw,
      review: verdict,
      ...(history.length > 0 ? { reviewHistory: history } : {}),
    };
  });
  return hit ? next : entities;
}

// ── 剧本评审位（production.scriptReview 列，FR-QA-07 ② · #2477）──────────────
// 剧本不是实体数组里的一条记录，判定与历史落在 production 自己的一列上；
// 上面实体那套「review + reviewHistory」的语义在这里用列形状复刻。

/** `production.scriptReview` 列的形状：当前判定 + 本轮之前的历次判定 + 改写前留档 + 人工裁决。 */
export interface ScriptReviewState {
  /** 当前有效判定；没评过 / 列里判定非法 → null。 */
  review: ReviewVerdict | null;
  /** 本轮之前的历次判定（旧→新，超限裁剪）；曲线 = `[...history, review]`。 */
  history: Array<ReviewVerdict>;
  /** 改写前的旧剧本全文（旧→新，超限从头裁剪）；缺省 = 还没有过 AI 改写。 */
  revisions: Array<ScriptRevision>;
  /** 人工裁决（#2480）：`digest` 记裁决时剧本指纹，剧本变过 → 裁决作废。 */
  humanVerdict: HumanVerdict | null;
}

/** 一次 AI 改写留档：改写发生的时间 + 改写前的完整剧本。 */
export interface ScriptRevision {
  /** ISO 时间戳（改写发生时）。 */
  at: string;
  /** 改写前的完整剧本 Markdown。 */
  markdown: string;
}

/** 宽容读取 `production.scriptReview` 列（未知 JSON → 形状）；缺省/畸形不抛，回落「没评过」。 */
export function normalizeScriptReviewState(raw: unknown): ScriptReviewState {
  const obj = asRecord(raw);
  if (!obj) {
    return { review: null, history: [], revisions: [], humanVerdict: null };
  }
  const history = (Array.isArray(obj.history) ? obj.history : [])
    .map((item) => normalizeReviewVerdict(item))
    .filter((item): item is ReviewVerdict => item !== null)
    .slice(-REVIEW_HISTORY_LIMIT);
  const revisions = (Array.isArray(obj.revisions) ? obj.revisions : [])
    .map((item) => {
      const rec = asRecord(item);
      if (!rec || typeof rec.markdown !== "string" || rec.markdown === "") {
        return null;
      }
      return {
        at: typeof rec.at === "string" ? rec.at : "",
        markdown: rec.markdown,
      };
    })
    .filter((item): item is ScriptRevision => item !== null)
    .slice(-SCRIPT_REVISION_LIMIT);
  return {
    review: normalizeReviewVerdict(obj.review),
    history,
    revisions,
    humanVerdict: normalizeHumanVerdict(obj.humanVerdict),
  };
}

/** 写回剧本评审（纯函数）：prev 的有效判定进 history（尾部追加、超上限从头裁剪）。 */
export function applyScriptReview(prev: unknown, verdict: ReviewVerdict): ScriptReviewState {
  const state = normalizeScriptReviewState(prev);
  const history = state.review
    ? tailWindow([...state.history, state.review], REVIEW_HISTORY_LIMIT)
    : state.history;
  return {
    review: verdict,
    history,
    revisions: state.revisions,
    humanVerdict: state.humanVerdict,
  };
}

/**
 * 写回剧本人工裁决（纯函数，#2480）：只动 `humanVerdict`，AI 判定与曲线原样保留。
 * 裁决快照带当前剧本指纹（`digest` 由调用方传入）—— 之后剧本变过（指纹不等）裁决作废。
 */
export function applyScriptHumanVerdict(prev: unknown, verdict: HumanVerdict): ScriptReviewState {
  const state = normalizeScriptReviewState(prev);
  return { ...state, humanVerdict: verdict };
}

/**
 * 改写前留档（纯函数）：把改写前的剧本全文压进 `revisions`（尾部追加、超限从头裁剪），
 * 判定与轮次历史原样保留 —— 旧版本可回看，人可据此接管。
 */
export function recordScriptRevision(
  prev: unknown,
  markdown: string,
  at: string,
): ScriptReviewState {
  const state = normalizeScriptReviewState(prev);
  return {
    ...state,
    revisions: tailWindow([...state.revisions, { at, markdown }], SCRIPT_REVISION_LIMIT),
  };
}

/**
 * 低分维度提取（收敛判据与定向改写共用）：从判定里挑出 `score <= maxScore` 的维度，
 * 按分升序（最差的先改）。未评分 / 无低分维度 → 空数组。
 */
export function weakScoreEntries(
  verdict: ReviewVerdict,
  maxScore = 3,
): Array<{ key: string; score: number; note: string }> {
  const scores = verdict.scores;
  if (!scores) {
    return [];
  }
  return Object.entries(scores)
    .filter(([, item]) => item.score <= maxScore)
    .map(([key, item]) => ({ key, score: item.score, note: item.note }))
    .sort((a, b) => a.score - b.score);
}

// ── 人工裁决（FR-QA-07 人工侧 · #2480）──────────────────────────────────────
// 人工裁决与 AI 判定同挂记录（`humanVerdict`），但语义**优先于 AI**（FR-AG-02
// 「质量停点由人拍板」）：人判废的镜头不因 AI 判过而放行进下一阶段；人判过的镜头
// AI 再红也定稿。裁决快照用于失效判断——实体在裁决之后又被改过（`rev` 变了 /
// 剧本指纹变了）→ 旧裁决不再作数，回到 AI 评审循环。

/** 一次人工裁决：通过 / 否决 + 一句话理由 + 裁决时的实体快照（失效判据）。 */
export interface HumanVerdict {
  /** 人拍板的结果：true = 定稿放行；false = 否决（触发重出 / 转人改）。 */
  pass: boolean;
  /** 一句话理由（人读，中文；可空——点个按钮不写字也合法）。 */
  note: string;
  /** ISO 裁决时间戳。 */
  at: string;
  /** 裁决时的实体 rev（镜头 / 角色侧）；实体此后被改过（rev 变大）→ 裁决作废。 */
  rev?: number;
  /** 裁决时的剧本指纹（仅剧本侧，`scriptDigestOf`）；剧本此后变过 → 裁决作废。 */
  digest?: string;
}

/** 宽容解析人工裁决；缺 `pass` 布尔判据 → null（没裁决过 / 脏数据，不硬造）。不抛。 */
export function normalizeHumanVerdict(raw: unknown): HumanVerdict | null {
  const obj = asRecord(raw);
  if (!obj || typeof obj.pass !== "boolean") {
    return null;
  }
  return {
    pass: obj.pass,
    note: typeof obj.note === "string" ? obj.note.trim() : "",
    at: typeof obj.at === "string" ? obj.at : "",
    ...(typeof obj.rev === "number" && Number.isFinite(obj.rev) ? { rev: obj.rev } : {}),
    ...(typeof obj.digest === "string" && obj.digest.trim() !== ""
      ? { digest: obj.digest.trim() }
      : {}),
  };
}

/** 读某条记录上已存的人工裁决；没裁决过 → null。 */
export function getRecordHumanVerdict(raw: unknown): HumanVerdict | null {
  const rec = asRecord(raw);
  if (!rec) {
    return null;
  }
  return normalizeHumanVerdict(rec.humanVerdict);
}

/**
 * 把人工裁决写回一批记录里 `id` 命中的那条（不可变返回新数组）。与 `applyReview`
 * 同口径：认 id、不认实体类型（镜头 / 角色卡共用）。无命中 → 原样返回入参引用。
 * 只动 `humanVerdict`，不碰 AI 的 `review` / `imageReview` —— 两套判定并存，
 * 优先级由消费方（规划器 / 评审收敛）按「人工优先」裁决。
 */
export function applyHumanVerdict(
  entities: Array<unknown>,
  id: string,
  verdict: HumanVerdict,
): Array<unknown> {
  let hit = false;
  const next = entities.map((raw) => {
    if (!isRecord(raw) || raw.id !== id) {
      return raw;
    }
    hit = true;
    return { ...raw, humanVerdict: verdict };
  });
  return hit ? next : entities;
}

/**
 * 人工评分（0~5，整档；null = 未评 / 清除）。越界夹取、非有限数 → null。
 * 挂在镜头记录上（`shot.humanRating`），是校准读数的人侧输入（对比 AI 维度分）。
 */
export function normalizeHumanRating(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return null;
  }
  return Math.round(clamp(raw, 0, 5));
}

/** 读某条记录上已存的人评分；没评过 → null。 */
export function getRecordHumanRating(raw: unknown): number | null {
  const rec = asRecord(raw);
  if (!rec) {
    return null;
  }
  return normalizeHumanRating(rec.humanRating);
}

/** 把人评分写回一批记录里 `id` 命中的那条（不可变返回新数组）；null = 清除。 */
export function applyHumanRating(
  entities: Array<unknown>,
  id: string,
  rating: number | null,
): Array<unknown> {
  let hit = false;
  const next = entities.map((raw) => {
    if (!isRecord(raw) || raw.id !== id) {
      return raw;
    }
    hit = true;
    const value = normalizeHumanRating(rating);
    // undefined 键不落：序列化后 null 与缺省在宽容读下等价，这里保留 null 显式语义。
    return value === null ? { ...raw, humanRating: null } : { ...raw, humanRating: value };
  });
  return hit ? next : entities;
}
