// 统一项目的「AI 自主执行 run」协调状态 + 纯规划器（Phase 6 地基）。
//
// 背景：画布与工坊是同一份 `Production` 的两个投影，AI 要能**自主把整条流水线（剧本→
// 角色→分镜→生图→视频→成片）连续跑完**，用户可在任一投影随时改一处，AI 改后**基于新内容续跑、
// 不覆盖用户手改**；是否需要点头可配（`ApprovalMode`）。
//
// 本文件是**纯逻辑**（无 React、无 IO，§18）：只描述 run 的形状、把 `Production` 归一成
// 规划视图、以及「下一步该做什么」的决策。真正的执行（调 LLM / 提交 ComfyUI 任务 / 出片）在
// 服务端引擎里消费这里的输出（P6-2）。run 落在 `production.run` 列，与 `progress` 一样是
// 两侧共读的持久态；但它由 run 控制端点**单独写**，不进工坊的 production 自动保存载荷——
// 否则工坊每次自动保存会覆盖掉 AI 的 run（字段所有权：工坊写内容字段、run 控制写 run）。
import {
  isProductionStage,
  normalizeProductionProgress,
  type ProductionStage,
} from "~/lib/production/progress";
import { tailWindow } from "~/lib/page-window";
import { asRecord } from "~/lib/is-record";
import {
  normalizeHumanRating,
  normalizeHumanVerdict,
  type HumanVerdict,
} from "~/lib/production/review-types";

/** 点头粒度：全自动 / 每阶段确认 / 逐镜确认。默认 `stage`。 */
export type ApprovalMode = "auto" | "stage" | "shot";

/** run 生命周期。`awaiting_approval`=跑到某步停下等用户点头；`paused`=用户主动暂停。 */
export type RunStatus =
  | "idle"
  | "running"
  | "awaiting_approval"
  | "paused"
  | "done"
  | "failed"
  | "cancelled";

/** 一条执行日志：引擎每执行一个动作追加一条，供 CLI / 控制条展示「跑了什么」。 */
export interface RunStep {
  /** ISO 时间戳。 */
  ts: string;
  /** 动作 kind（generate_script / extract_characters / plan_storyboard / render_images / render_film / done / failed…）。 */
  kind: string;
  ok: boolean;
  /** 人读摘要（产出了什么 / 失败原因）。 */
  detail: string;
}

export interface ProductionRun {
  status: RunStatus;
  approvalMode: ApprovalMode;
  /** 当前阶段游标（与 progress.stage 同源，run 期间由引擎推进）。 */
  stage: ProductionStage;
  /** 用户的一句话目标 / 意图（可选，供模型规划参考）。 */
  goal: string;
  /** status=awaiting_approval 时，在等哪个阶段被确认。 */
  awaitingStage: ProductionStage | null;
  /** 逐镜生图 / 出片用的工作流库工作流 id（本地链路唯一来源，由 start 带入、存进 run）。 */
  imageWorkflowId: string;
  videoWorkflowId: string;
  /** 已触发出片的时间戳（非空=已 kick render，引擎下一步只等 rendered、不重复起）。 */
  filmStartedAt: string;
  /**
   * 每个镜头「上次被本 run 处理完时」的 rev 快照。当前镜头 rev > 快照值 → 用户在之后改过
   * （换图 / 改提示词 / 退回），规划器据此把该镜重新纳入待办——这是「基于改动续跑」的判据。
   */
  processedShotRev: Record<string, number>;
  /**
   * 自动评审（Phase 8 · P8-1c）：生图后逐镜 AI 评审，不合格自动抽卡重生成（换种子），有界重试。
   * 默认 false（不改既有 run 行为）；由 `run.start` 带入。
   */
  autoReview: boolean;
  /** 每个镜头「上次被本 run 评审并定稿（通过 / 达重试上限保留）」时的 rev 快照。当前 rev > 快照 → 该镜需（再）评审。 */
  reviewedShotRev: Record<string, number>;
  /** 每个镜头已被自动抽卡重出的次数；达 `REVIEW_MAX_RETRY` 后保留当前结果、停止返工（避免无限循环）。 */
  reviewAttempts: Record<string, number>;
  /**
   * 剧本质量闭环（FR-QA-07 ④ · #2478）：上次剧本评审收口时的剧本指纹
   * （`scriptDigestOf`）。与当前剧本指纹不等 → 剧本变过（AI 改写 / 人手改）→ 待（再）评审；
   * 相等 → 剧本质量节点已收口。空串 = 还没评过。
   */
  scriptReviewDigest: string;
  /** 已完成的剧本评审轮数（与镜头 `reviewAttempts` 同口径：达上限保留、停止返工）。 */
  scriptReviewAttempts: number;
  /** 评审提出改写、尚未改写 → true；规划器先出 `revise_script`，改完剧本变 → 回到待评审。 */
  scriptRevisionPending: boolean;
  /**
   * 分镜联动：上次规划分镜时的剧本指纹。与当前不等 → 剧本在分镜之后变过
   * （AI 改写定稿 / 人手改）→ 重排分镜，让下游真的吃到新剧本（仅 autoReview 生效）。
   */
  storyboardScriptDigest: string;
  /** 执行日志（引擎每步追加，有界；见 appendRunStep）。 */
  log: RunStep[];
  error: string | null;
  updatedAt: string;
}

export const DEFAULT_PRODUCTION_RUN: ProductionRun = {
  status: "idle",
  approvalMode: "stage",
  stage: "script",
  goal: "",
  awaitingStage: null,
  imageWorkflowId: "",
  videoWorkflowId: "",
  filmStartedAt: "",
  processedShotRev: {},
  autoReview: false,
  reviewedShotRev: {},
  reviewAttempts: {},
  scriptReviewDigest: "",
  scriptReviewAttempts: 0,
  scriptRevisionPending: false,
  storyboardScriptDigest: "",
  log: [],
  error: null,
  updatedAt: "",
};

/** 执行日志上限：只保留最近 N 条，避免 run 列无限膨胀。 */
export const RUN_LOG_LIMIT = 80;

/** 自动评审不合格时，每镜最多抽卡重出几次（超过则保留当前结果，避免无限返工）。 */
export const REVIEW_MAX_RETRY = 2;

/**
 * 剧本评审的分数阈值（FR-QA-07 ④ · #2478）：`pass=true` 且维度均分达线才算「达标」。
 * pass 与分数相互独立（低分但勉强可用可 pass=true），收敛判据两者都要——否则
 * 「全 1 分却 pass」的剧本会一路直达 done，闭环形同虚设。未评分（旧判定 / 模型没给）
 * 时只看 pass，不硬造分数。
 */
export const SCRIPT_REVIEW_SCORE_THRESHOLD = 3.5;

/** 追加一条执行日志（不可变，尾部追加、超上限从头裁剪）。 */
export function appendRunStep(run: ProductionRun, step: RunStep): ProductionRun {
  return { ...run, log: tailWindow([...run.log, step], RUN_LOG_LIMIT) };
}

const RUN_STATUSES: readonly RunStatus[] = [
  "idle",
  "running",
  "awaiting_approval",
  "paused",
  "done",
  "failed",
  "cancelled",
];
const APPROVAL_MODES: readonly ApprovalMode[] = ["auto", "stage", "shot"];

/** 宽容解析一个 `id → 有限数字` 的映射（rev 快照类字段共用）；非对象 / 非法值丢弃。 */
function parseRevMap(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const source = asRecord(raw);
  if (!source) return out;
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

/** 未知值（production.run 列）→ 规范化 ProductionProgress run；非法/缺字段回落默认，不抛。 */
export function normalizeProductionRun(raw: unknown): ProductionRun {
  const obj = asRecord(raw);
  if (!obj) return { ...DEFAULT_PRODUCTION_RUN };
  const status = RUN_STATUSES.includes(/* SAFETY: 类型断言已复核 */ obj.status as RunStatus)
    ? /* SAFETY: 类型断言已复核 */ (obj.status as RunStatus)
    : "idle";
  const approvalMode = APPROVAL_MODES.includes(
    /* SAFETY: 类型断言已复核 */ obj.approvalMode as ApprovalMode,
  )
    ? /* SAFETY: 类型断言已复核 */ (obj.approvalMode as ApprovalMode)
    : "stage";
  const log: RunStep[] = [];
  if (Array.isArray(obj.log)) {
    for (const raw of obj.log) {
      const rec = asRecord(raw);
      if (!rec || typeof rec.ts !== "string") continue;
      log.push({
        ts: rec.ts,
        kind: typeof rec.kind === "string" ? rec.kind : "info",
        ok: rec.ok !== false,
        detail: typeof rec.detail === "string" ? rec.detail : "",
      });
    }
  }
  return {
    status,
    approvalMode,
    stage: isProductionStage(obj.stage) ? obj.stage : "script",
    goal: typeof obj.goal === "string" ? obj.goal : "",
    awaitingStage: isProductionStage(obj.awaitingStage) ? obj.awaitingStage : null,
    imageWorkflowId: typeof obj.imageWorkflowId === "string" ? obj.imageWorkflowId : "",
    videoWorkflowId: typeof obj.videoWorkflowId === "string" ? obj.videoWorkflowId : "",
    filmStartedAt: typeof obj.filmStartedAt === "string" ? obj.filmStartedAt : "",
    processedShotRev: parseRevMap(obj.processedShotRev),
    autoReview: obj.autoReview === true,
    reviewedShotRev: parseRevMap(obj.reviewedShotRev),
    reviewAttempts: parseRevMap(obj.reviewAttempts),
    scriptReviewDigest: typeof obj.scriptReviewDigest === "string" ? obj.scriptReviewDigest : "",
    scriptReviewAttempts:
      typeof obj.scriptReviewAttempts === "number" &&
      Number.isFinite(obj.scriptReviewAttempts) &&
      obj.scriptReviewAttempts >= 0
        ? Math.floor(obj.scriptReviewAttempts)
        : 0,
    scriptRevisionPending: obj.scriptRevisionPending === true,
    storyboardScriptDigest:
      typeof obj.storyboardScriptDigest === "string" ? obj.storyboardScriptDigest : "",
    log,
    error: typeof obj.error === "string" ? obj.error : null,
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : "",
  };
}

/** 规划器消费的镜头视图（从 `production.shots` 的未知项归一）。 */
export interface ShotRunView {
  id: string;
  /** 用户每改一次该镜就 +1（写入点在 P6-2/P6-3）；缺省 0。 */
  rev: number;
  hasImage: boolean;
  hasClip: boolean;
  /** 人工裁决（#2480）：`rev` 快照与镜头当前 rev 相等才新鲜（有效）。没裁决过 → null/缺省。 */
  humanVerdict?: HumanVerdict | null;
  /** 人工评分 0~5（#2480，校准读数的人侧输入）；没评 → null/缺省。 */
  humanRating?: number | null;
}

/** 由整份 production 归一的规划视图。 */
export interface ProductionRunView {
  hasScript: boolean;
  /** 当前剧本的指纹（`scriptDigestOf`）：剧本变了指纹就变，是「基于改动续跑」的剧本侧判据。 */
  scriptDigest: string;
  characterCount: number;
  shots: ShotRunView[];
  filmRendered: boolean;
  /** 剧本人工裁决（#2480）：`digest` 快照与当前剧本指纹相等才新鲜（有效）。没裁决过 → null/缺省。 */
  scriptHumanVerdict?: HumanVerdict | null;
}

/** production 行的最浅读法（字段都可能是未知 JSON，这里宽容读）。 */
export interface ProductionLike {
  scriptMarkdown?: unknown;
  characters?: unknown;
  shots?: unknown;
  progress?: unknown;
  scriptReview?: unknown;
}

/**
 * 剧本指纹（轻量 djb2 十六进制，纯 JS、无 Node 依赖——本文件同时被客户端消费）：
 * 只用于「变没变」的相等比较，不追求防碰撞加密强度。
 */
export function scriptDigestOf(markdown: string): string {
  let hash = 5381;
  for (let i = 0; i < markdown.length; i++) {
    hash = ((hash << 5) + hash + markdown.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** 把 production 行归一成规划视图（无行 → 全空，等价「连剧本都还没有」）。 */
export function toRunView(production: ProductionLike | null): ProductionRunView {
  const shotsRaw = production && Array.isArray(production.shots) ? production.shots : [];
  const shots: ShotRunView[] = [];
  for (const item of shotsRaw) {
    const rec = asRecord(item);
    if (!rec || typeof rec.id !== "string") continue;
    shots.push({
      id: rec.id,
      rev: typeof rec.rev === "number" && Number.isFinite(rec.rev) ? rec.rev : 0,
      hasImage: Boolean(rec.imageUrl),
      hasClip: Boolean(rec.clipUrl),
      humanVerdict: normalizeHumanVerdict(rec.humanVerdict),
      humanRating: normalizeHumanRating(rec.humanRating),
    });
  }
  const characters =
    production && Array.isArray(production.characters) ? production.characters : [];
  const script = typeof production?.scriptMarkdown === "string" ? production.scriptMarkdown : "";
  const scriptReviewRaw = asRecord(production?.scriptReview);
  return {
    hasScript: script.trim().length > 0,
    scriptDigest: scriptDigestOf(script),
    characterCount: characters.length,
    shots,
    filmRendered: normalizeProductionProgress(production?.progress).rendered,
    scriptHumanVerdict: normalizeHumanVerdict(scriptReviewRaw?.humanVerdict),
  };
}

/** 规划器输出的「下一步动作」。 */
export type RunAction =
  | { kind: "idle" }
  | { kind: "done" }
  | { kind: "await_approval"; stage: ProductionStage }
  | { kind: "generate_script" }
  | { kind: "review_script" }
  | { kind: "revise_script" }
  | { kind: "extract_characters" }
  | { kind: "plan_storyboard" }
  | { kind: "render_images"; shotIds: string[] }
  | { kind: "review_shots"; shotIds: string[] }
  | { kind: "render_film" };

/**
 * 给定当前 production 视图 + run 状态，算「下一步该做的一个动作」。纯 state-driven：
 *   · 非 running → 由 status 决定（awaiting_approval 透出待确认阶段；done/idle 原样）。
 *   · running → 沿「剧本→角色→分镜→生图→(自动评审→返工)→(视频+合成成片)」找**第一个未完成**的步骤：
 *     某镜 `hasImage=false` 或 `rev` 比 run 处理快照更新（用户改过/退回）→ 纳入待生图；
 *     开了 `autoReview` 且有镜头已出图但「评审定稿快照」落后于当前 rev → 纳入待评审（评审不合格会
 *     抽卡重出、把该镜 rev 抬高 → 又回到待生图，直到通过或达重试上限）；
 *     图齐（且评审已定稿）未出片 → render_film；已出片 → done。
 * 这里只出「做什么」，「做完后是否停下等点头」由执行引擎按 approvalMode 处理（P6-2）。
 */
export function planNextRunAction(view: ProductionRunView, run: ProductionRun): RunAction {
  switch (run.status) {
    case "awaiting_approval":
      return { kind: "await_approval", stage: run.awaitingStage ?? run.stage };
    case "running":
      break;
    case "done":
      return { kind: "done" };
    default:
      // idle / paused / failed / cancelled → 引擎不动作。
      return { kind: "idle" };
  }
  if (!view.hasScript) return { kind: "generate_script" };
  // 剧本质量闭环（FR-QA-07 ④ · #2478）：剧本指纹 ≠ 评审收口快照 → 待评审（首评 =
  // 快照还是空串，同样命中）；评审提出改写 → 先定向改写（改完剧本变 → 指纹变 → 回到待评审）。
  // 「人机接力」靠同一把指纹：人改剧本 → 指纹变 → AI 从人改的版本继续评。
  // 人工裁决优先（#2480）：人拍板「通过」且剧本此后没变过（裁决快照 digest = 当前指纹）
  // → 视为已收口，AI 不再评；人否决不产生豁免（不收口，AI 循环照跑——改写后指纹变，
  // 旧裁决自然失效）。
  if (run.autoReview) {
    if (run.scriptRevisionPending) return { kind: "revise_script" };
    const humanApproved =
      view.scriptHumanVerdict?.pass === true &&
      view.scriptHumanVerdict.digest === view.scriptDigest;
    if (run.scriptReviewDigest !== view.scriptDigest && !humanApproved)
      return { kind: "review_script" };
  }
  if (view.characterCount === 0) return { kind: "extract_characters" };
  if (view.shots.length === 0) return { kind: "plan_storyboard" };
  // 分镜联动（#2478 ④）：分镜之后剧本变过（AI 改写定稿 / 人手改）→ 重排分镜，
  // 让下游真的吃到新剧本（FR-QA-01「改剧本重跑分镜，镜头描述随之改变」）。
  // 分镜是整幅覆盖（既有语义），因此只在 autoReview 的自动链路里生效；快照在
  // 引擎执行 plan_storyboard 时写入 —— 没变过的剧本不会反复重排。
  if (run.autoReview && run.storyboardScriptDigest !== view.scriptDigest)
    return { kind: "plan_storyboard" };
  const needImage = view.shots
    .filter((s) => {
      if (!s.hasImage) return true;
      // 仅当「本 run 之前处理过该镜」且当前 rev 又变新（用户在其后改过 / 退回），才重做；
      // 从未被本 run 处理过（快照缺省）时，已有图的镜头视为已完成、不纳入。
      const done = run.processedShotRev[s.id];
      return done !== undefined && done < s.rev;
    })
    .map((s) => s.id);
  if (needImage.length > 0) return { kind: "render_images", shotIds: needImage };
  // 自动评审：图齐后，把「已出图但评审定稿快照落后于当前 rev」的镜头纳入待评审。
  // 评审不合格的抽卡会抬高该镜 rev → 重新出现在 needImage → 重出后再评，直到通过或达上限。
  // 人工裁决优先（#2480 · FR-AG-02 质量停点由人拍板）：
  //   · 人通过且快照新鲜（humanVerdict.rev = 当前 rev）→ 定稿，AI 不再评（AI 再红也算过）；
  //   · 人否决且快照新鲜 → 即使 AI 已定稿也拉回评审循环——执行器把否决当不合格、
  //     抽卡重出（抬 rev）→ 旧裁决随 rev 失效、AI 评审兜底接管，不会死循环；
  //     达 `REVIEW_MAX_RETRY` 上限后保留当前结果（与 AI 侧「达上限转人工」同口径），
  //     人的出路是改镜头（rev 变 → 裁决失效）或点「通过」（定稿放行）。
  if (run.autoReview) {
    const needReview = view.shots
      .filter((s) => {
        if (!s.hasImage) return false;
        const human = s.humanVerdict;
        if (human?.pass === true && human.rev === s.rev) return false;
        if ((run.reviewedShotRev[s.id] ?? -1) >= s.rev) {
          return (
            human?.pass === false &&
            human.rev === s.rev &&
            (run.reviewAttempts[s.id] ?? 0) < REVIEW_MAX_RETRY
          );
        }
        return true;
      })
      .map((s) => s.id);
    if (needReview.length > 0) return { kind: "review_shots", shotIds: needReview };
  }
  if (!view.filmRendered) return { kind: "render_film" };
  return { kind: "done" };
}

/**
 * 一个动作做完后，产出应写回的 run 更新（供引擎持久化）：把相关镜头的 rev 记进快照，表示
 * 「这一版已被处理」；用户之后再改（rev 变大）就会被规划器重新纳入。纯函数、不可变。
 */
export function markActionProcessed(
  run: ProductionRun,
  view: ProductionRunView,
  action: RunAction,
): ProductionRun {
  const next: ProductionRun = {
    ...run,
    processedShotRev: { ...run.processedShotRev },
  };
  switch (action.kind) {
    case "render_images": {
      const revById = new Map(view.shots.map((s) => [s.id, s.rev]));
      for (const shotId of action.shotIds) {
        const rev = revById.get(shotId);
        if (rev !== undefined) next.processedShotRev[shotId] = rev;
      }
      return next;
    }
    default:
      return next;
  }
}
