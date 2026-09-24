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
  log: [],
  error: null,
  updatedAt: "",
};

/** 执行日志上限：只保留最近 N 条，避免 run 列无限膨胀。 */
export const RUN_LOG_LIMIT = 80;

/** 自动评审不合格时，每镜最多抽卡重出几次（超过则保留当前结果，避免无限返工）。 */
export const REVIEW_MAX_RETRY = 2;

/** 追加一条执行日志（不可变，尾部追加、超上限从头裁剪）。 */
export function appendRunStep(
  run: ProductionRun,
  step: RunStep,
): ProductionRun {
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
  const status = RUN_STATUSES.includes(obj.status as RunStatus)
    ? (obj.status as RunStatus)
    : "idle";
  const approvalMode = APPROVAL_MODES.includes(obj.approvalMode as ApprovalMode)
    ? (obj.approvalMode as ApprovalMode)
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
    awaitingStage: isProductionStage(obj.awaitingStage)
      ? obj.awaitingStage
      : null,
    imageWorkflowId:
      typeof obj.imageWorkflowId === "string" ? obj.imageWorkflowId : "",
    videoWorkflowId:
      typeof obj.videoWorkflowId === "string" ? obj.videoWorkflowId : "",
    filmStartedAt:
      typeof obj.filmStartedAt === "string" ? obj.filmStartedAt : "",
    processedShotRev: parseRevMap(obj.processedShotRev),
    autoReview: obj.autoReview === true,
    reviewedShotRev: parseRevMap(obj.reviewedShotRev),
    reviewAttempts: parseRevMap(obj.reviewAttempts),
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
}

/** 由整份 production 归一的规划视图。 */
export interface ProductionRunView {
  hasScript: boolean;
  characterCount: number;
  shots: ShotRunView[];
  filmRendered: boolean;
}

/** production 行的最浅读法（字段都可能是未知 JSON，这里宽容读）。 */
interface ProductionLike {
  scriptMarkdown?: unknown;
  characters?: unknown;
  shots?: unknown;
  progress?: unknown;
}

/** 把 production 行归一成规划视图（无行 → 全空，等价「连剧本都还没有」）。 */
export function toRunView(
  production: ProductionLike | null,
): ProductionRunView {
  const shotsRaw =
    production && Array.isArray(production.shots) ? production.shots : [];
  const shots: ShotRunView[] = [];
  for (const item of shotsRaw) {
    const rec = asRecord(item);
    if (!rec || typeof rec.id !== "string") continue;
    shots.push({
      id: rec.id,
      rev:
        typeof rec.rev === "number" && Number.isFinite(rec.rev) ? rec.rev : 0,
      hasImage: Boolean(rec.imageUrl),
      hasClip: Boolean(rec.clipUrl),
    });
  }
  const characters =
    production && Array.isArray(production.characters)
      ? production.characters
      : [];
  return {
    hasScript:
      typeof production?.scriptMarkdown === "string"
        ? production.scriptMarkdown.trim().length > 0
        : false,
    characterCount: characters.length,
    shots,
    filmRendered: normalizeProductionProgress(production?.progress).rendered,
  };
}

/** 规划器输出的「下一步动作」。 */
export type RunAction =
  | { kind: "idle" }
  | { kind: "done" }
  | { kind: "await_approval"; stage: ProductionStage }
  | { kind: "generate_script" }
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
export function planNextRunAction(
  view: ProductionRunView,
  run: ProductionRun,
): RunAction {
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
  if (view.characterCount === 0) return { kind: "extract_characters" };
  if (view.shots.length === 0) return { kind: "plan_storyboard" };
  const needImage = view.shots
    .filter((s) => {
      if (!s.hasImage) return true;
      // 仅当「本 run 之前处理过该镜」且当前 rev 又变新（用户在其后改过 / 退回），才重做；
      // 从未被本 run 处理过（快照缺省）时，已有图的镜头视为已完成、不纳入。
      const done = run.processedShotRev[s.id];
      return done !== undefined && done < s.rev;
    })
    .map((s) => s.id);
  if (needImage.length > 0)
    return { kind: "render_images", shotIds: needImage };
  // 自动评审：图齐后，把「已出图但评审定稿快照落后于当前 rev」的镜头纳入待评审。
  // 评审不合格的抽卡会抬高该镜 rev → 重新出现在 needImage → 重出后再评，直到通过或达上限。
  if (run.autoReview) {
    const needReview = view.shots
      .filter((s) => s.hasImage && (run.reviewedShotRev[s.id] ?? -1) < s.rev)
      .map((s) => s.id);
    if (needReview.length > 0)
      return { kind: "review_shots", shotIds: needReview };
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
