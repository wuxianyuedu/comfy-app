// 服务端 run 执行引擎（Phase 6 · P6-2）。
//
// 消费 P6-1 的 run + 规划器，把「AI 自主把整条流水线跑到成片」落成一次**可重入的推进循环**：
// 每一步都**重读当前 `production` + run**，据此决定动作、执行、写回，再按 `approvalMode` 决定
// 是否停下等点头。因为状态每次都从库里重读：
//   · 用户在画布/工坊点了「暂停 / 取消」→ 下一 tick 见 status≠running 即让位（自主循环在服务器跑，
//     不随视图切换而死 —— 这是把引擎放服务端而非工坊 agent 里的原因）。
//   · 用户改了某镜（rev 变新）→ 规划器把该镜重新纳入待办，基于改后的内容续跑，不覆盖手改。
// 引擎只做「推进到下一个停点」，由 `run.start / resume / approve` 以 fire-and-forget 方式拉起。
//
// LLM 阶段与 ComfyUI 生图/合成的真实产出需在有模型/ComfyUI 的环境端到端验证；本模块的循环控制
// （计划→执行→审批/暂停/字段所有权）以 mock 单测覆盖。
import "server-only";

import { z } from "zod";

import { productionRepository } from "~/lib/core/repository-production";
import { completeLLM, completeLLMStructured, getLLMConfig } from "~/lib/llm/server";
import { buildScriptMarkdownMessages } from "~/lib/llm/prompts";
import { synthesizeFirstFrame } from "~/lib/comfyui/firstframe";
import { randomSeed } from "~/lib/comfyui/random-seed";
import { workshopUid } from "~/lib/workshop/script-parser";
import {
  markActionProcessed,
  normalizeProductionRun,
  planNextRunAction,
  scriptDigestOf,
  toRunView,
  appendRunStep,
  REVIEW_MAX_RETRY,
  SCRIPT_REVIEW_SCORE_THRESHOLD,
  type ProductionRun,
  type ProductionRunView,
  type RunAction,
} from "~/lib/production/run-types";
import { applyShotRedo } from "~/lib/production/sync";
import { reviewScoreMean } from "~/lib/production/review-types";
import { fixed } from "~/lib/number-format";
import { displayValue } from "~/lib/display-value";
import { reviewContent, reviewScript, reviewShotImage, reviseScript } from "~/server/agent/review";
import type { ProductionStage } from "~/lib/production/progress";
import { errorMessage } from "~/lib/error-message";
import type { Character, ProjectType, Shot } from "~/lib/workshop/types";
import type { Production } from "~/server/db/schema";
import { sleep } from "~/lib/with-timeout";

const MAX_TICKS = 240;
const TICK_MS = 4000;
const nowIso = () => new Date().toISOString();

type ExecResult = {
  error?: string;
  ok: boolean;
  /** 执行后应写回的 run（多数动作不改 run，返回 undefined 表示沿用原 run）。 */
  run?: ProductionRun;
  /** 该步只是等待（如出片未就绪），不追加执行日志，避免每拍刷屏。 */
  skipLog?: boolean;
  /** 人读产出摘要（写进执行日志），如「已生成剧本（1234 字）」。 */
  summary?: string;
};

/** 动作 kind → 日志里的动作名。 */
function actionLabel(action: RunAction): string {
  switch (action.kind) {
    case "generate_script":
      return "生成剧本";
    case "review_script":
      return "剧本评审";
    case "revise_script":
      return "按评审意见改写剧本";
    case "extract_characters":
      return "提取角色";
    case "plan_storyboard":
      return "规划分镜";
    case "render_images":
      return `逐镜生图（${action.shotIds.length} 个）`;
    case "review_shots":
      return `逐镜评审（${action.shotIds.length} 个）`;
    case "render_film":
      return "生成视频并合成成片";
    default:
      return action.kind;
  }
}

/** 动作 → 完成后要 gate / 推进到的阶段。 */
function gateStageFor(action: RunAction): ProductionStage | null {
  switch (action.kind) {
    case "generate_script":
    case "review_script":
    case "revise_script":
      return "script";
    case "extract_characters":
      return "character";
    case "plan_storyboard":
      return "storyboard";
    case "render_images":
    case "review_shots":
      return "shots";
    case "render_film":
      return "render";
    default:
      return null;
  }
}

async function saveRun(userId: string, projectId: string, run: ProductionRun) {
  await productionRepository.updateRun(userId, projectId, {
    ...run,
    updatedAt: nowIso(),
  });
}

function projectMeta(row: Production) {
  return {
    type: /* SAFETY: 类型断言已复核 */ row.type as ProjectType,
    tone: row.tone,
    logline: row.logline,
    title: row.title,
  };
}

// ── 执行器：每个只做一件事，写回走 patchContent（不碰 run/progress），结果经 ExecResult.run 带出 ──

async function execScript(
  userId: string,
  projectId: string,
  run: ProductionRun,
  row: Production,
): Promise<ExecResult> {
  const cfg = await getLLMConfig();
  const idea = run.goal.trim() || row.title;
  const md = (await completeLLM(cfg, buildScriptMarkdownMessages(projectMeta(row), idea))).trim();
  if (!md) {
    return { ok: false, error: "模型未返回剧本内容" };
  }
  await productionRepository.patchContent(userId, projectId, {
    scriptMarkdown: md,
  });
  return { ok: true, summary: `已生成剧本（${md.length} 字）` };
}

async function execCharacters(
  userId: string,
  projectId: string,
  row: Production,
): Promise<ExecResult> {
  if (!row.scriptMarkdown.trim()) {
    return { ok: false, error: "剧本为空，无法提取角色" };
  }
  const cfg = await getLLMConfig();
  const briefs = await completeLLMStructured(
    cfg,
    [
      {
        role: "system",
        content:
          '从剧本提取主要角色，输出严格 JSON 数组，元素 {"name":string,"appearance"?:string,"costume"?:string,"personality"?:string}，不要多余文字。',
      },
      { role: "user", content: row.scriptMarkdown.slice(0, 8000) },
    ],
    z.array(
      z.object({
        name: z.string(),
        appearance: z.string().optional(),
        costume: z.string().optional(),
        personality: z.string().optional(),
      }),
    ),
  );
  const created: Array<Character> = briefs
    .filter((c) => c.name.trim() !== "")
    .map((c) => ({
      id: workshopUid("char"),
      name: c.name,
      ageGender: "",
      appearance: c.appearance ?? "",
      costume: c.costume ?? "",
      personality: c.personality ?? "",
      temperament: "",
      styleTags: [],
      positivePrompt: "",
      negativePrompt: "",
      params: {},
    }));
  if (created.length === 0) {
    return { ok: false, error: "未从剧本解析出角色" };
  }
  await productionRepository.patchContent(userId, projectId, {
    characters: created,
  });
  return { ok: true, summary: `已提取 ${created.length} 个角色` };
}

async function execStoryboard(
  userId: string,
  projectId: string,
  run: ProductionRun,
  row: Production,
): Promise<ExecResult> {
  if (!row.scriptMarkdown.trim()) {
    return { ok: false, error: "剧本为空，无法规划分镜" };
  }
  const cfg = await getLLMConfig();
  const items = await completeLLMStructured(
    cfg,
    [
      {
        role: "system",
        content:
          '把剧本拆成分镜镜头序列，输出严格 JSON 数组，元素 {"sceneHeading":string,"description":string,"shotType"?:string}，不要多余文字。',
      },
      { role: "user", content: row.scriptMarkdown.slice(0, 8000) },
    ],
    z.array(
      z.object({
        sceneHeading: z.string().optional(),
        description: z.string(),
        shotType: z.string().optional(),
      }),
    ),
  );
  const shots: Array<Shot> = items
    .filter((it) => it.description.trim() !== "")
    .map((it, i) => ({
      id: workshopUid("shot"),
      index: i,
      sceneId: "",
      sceneHeading: it.sceneHeading ?? "",
      shotType: /* SAFETY: 类型断言已复核 */ (it.shotType ?? "medium") as Shot["shotType"],
      description: it.description,
      characterIds: [],
      prompt: it.description,
      negativePrompt: "",
      params: {},
      status: "idle",
      rev: 0,
    }));
  if (shots.length === 0) {
    return { ok: false, error: "未解析出分镜镜头" };
  }
  await productionRepository.patchContent(userId, projectId, { shots });
  // 记下「这次分镜是按哪版剧本拆的」：之后剧本变（AI 改写定稿 / 人手改）→
  // 规划器按指纹差把分镜重新纳入（#2478 ④ 的分镜联动）。
  return {
    ok: true,
    summary: `已规划 ${shots.length} 个镜头`,
    run: { ...run, storyboardScriptDigest: scriptDigestOf(row.scriptMarkdown) },
  };
}

async function execImages(
  userId: string,
  projectId: string,
  run: ProductionRun,
  row: Production,
  view: ProductionRunView,
  shotIds: Array<string>,
): Promise<ExecResult> {
  if (!run.imageWorkflowId) {
    return {
      ok: false,
      error: "缺少图类工作流（imageWorkflowId），无法逐镜生图",
    };
  }
  /* SAFETY: 类型断言已复核 */
  const shots = Array.isArray(row.shots) ? (row.shots as Array<Shot>) : [];
  const want = new Set(shotIds);
  const next: Array<Shot> = [];
  for (const shot of shots) {
    if (!want.has(shot.id)) {
      next.push(shot);
      continue;
    }
    // 「种子」算高级输入、默认随机：每次自主出图都带一个新的随机 seed（首刷与抽卡重出一样），
    // 让同提示词每次重跑都能换图。seed 只经「种子」对外参数下发（synthesizeFirstFrame →
    // createWorkflowRunTask → buildEncapsulatedInputs → applyParamMapping），落到作者在工作流里
    // 连好的 seed / noise_seed 端口上；作者没连这一口 → 落进 unmatched、不写任何节点，工作流用它
    // 图内自带的 seed。运行期绝不直接改写工作流节点（不动 control_after_generate、不注图内 seed）。
    try {
      const path = await synthesizeFirstFrame({
        userId,
        workflowId: run.imageWorkflowId,
        prompt: shot.prompt,
        negative: shot.negativePrompt || undefined,
        projectId,
        seed: randomSeed(),
      });
      next.push({ ...shot, imageUrl: path, status: "done" });
    } catch {
      // 单镜失败：记为 failed，不阻断其它镜；已处理 rev 仍写，避免无限重试同一坏镜。
      next.push({ ...shot, status: "failed" });
    }
  }
  await productionRepository.patchContent(userId, projectId, { shots: next });
  const doneCount = next.filter((s) => want.has(s.id) && s.status === "done").length;
  const failedCount = shotIds.length - doneCount;
  // 记录这些镜头「已按当前 rev 处理」——用户之后再改（rev 变大）会被重新纳入。
  return {
    ok: true,
    summary: `逐镜生图：${doneCount} 成功${failedCount > 0 ? ` / ${failedCount} 失败` : ""}`,
    run: markActionProcessed(run, view, { kind: "render_images", shotIds }),
  };
}

/**
 * 剧本评审执行器（FR-QA-07 ④ · #2478）：调 `reviewScript` 出判定（同时落库
 * `production.scriptReview` 列，含轮次历史），按「pass 且维度均分达线」判达标：
 *   · 达标 / 已达 `REVIEW_MAX_RETRY` 上限 → 写剧本指纹快照（收口，规划器不再纳入；
 *     达上限保留当前结果与镜头评审同口径）；
 *   · 不达标且未达上限 → `scriptRevisionPending=true`，规划器下一步出 `revise_script`；
 *     改写后剧本变（指纹变）→ 又回到待评审，直到达标或轮次封顶。
 * 每轮判定与分数已由 `reviewScript` 落库，曲线可回看。
 */
async function execReviewScript(
  userId: string,
  projectId: string,
  run: ProductionRun,
  row: Production,
): Promise<ExecResult> {
  let outcome;
  try {
    outcome = await reviewScript(userId, projectId);
  } catch (e: unknown) {
    return { ok: false, error: errorMessage(e, "剧本评审失败") };
  }
  const attempts = run.scriptReviewAttempts + 1;
  const mean = reviewScoreMean(outcome.verdict);
  const qualified =
    outcome.verdict.pass && (mean === null || mean >= SCRIPT_REVIEW_SCORE_THRESHOLD);
  // 「均分 X.X」是给人读的：数字精度格式化走唯一出口（P50），缺值占位走
  // displayValue（P8）—— 都是「这组判据只有一份口径」的收口。
  const meanText = mean === null ? "未评分" : `均分 ${displayValue(fixed(mean, 1))}`;
  // 收口（达标或封顶）→ 写指纹快照；未收口 → 挂「待改写」，改完剧本变会再回评审。
  const settle = {
    scriptReviewAttempts: attempts,
    scriptRevisionPending: false,
    scriptReviewDigest: scriptDigestOf(row.scriptMarkdown),
  };
  if (qualified) {
    return {
      ok: true,
      summary: `剧本评审通过（${meanText}）`,
      run: { ...run, ...settle },
    };
  }
  if (attempts > REVIEW_MAX_RETRY) {
    return {
      ok: true,
      summary: `剧本评审未达标（${meanText}），已达改写上限、保留当前版本`,
      run: { ...run, ...settle },
    };
  }
  return {
    ok: true,
    summary: `剧本评审未达标（${meanText}）→ 按低分维度定向改写（第 ${attempts}/${REVIEW_MAX_RETRY} 轮）`,
    run: {
      ...run,
      scriptReviewAttempts: attempts,
      scriptRevisionPending: true,
    },
  };
}

/**
 * 剧本定向改写执行器（#2478 ④）：`reviseScript` 消费上一轮评审的低分维度产出新剧本
 * （旧版留档 `scriptReview.revisions`），写 `scriptRevisionPending=false` —— 改写后
 * 剧本指纹已变，下一 tick 规划器自动回到 `review_script` 复评，有界循环由此闭合。
 */
async function execReviseScript(
  userId: string,
  projectId: string,
  run: ProductionRun,
): Promise<ExecResult> {
  let md: string;
  try {
    md = await reviseScript(userId, projectId);
  } catch (e: unknown) {
    return { ok: false, error: errorMessage(e, "剧本定向改写失败") };
  }
  return {
    ok: true,
    summary: `已按评审意见改写剧本（${md.length} 字，旧版已留档）`,
    run: { ...run, scriptRevisionPending: false },
  };
}

/**
 * 自动评审执行器（Phase 8 · P8-1c + P8-2）：逐镜做「文本 + 图」双裁判——
 *   · 文本评审（`reviewContent` → `shot.review`）：评提示词写得好不好；
 *   · 视觉评审（`reviewShotImage` → `shot.imageReview`，仅镜头已出图时）：看图评对题/崩没崩；
 *   两者**都过**才算通过（图没过 = 不过，FR-QA-07⑤）。
 * 据此：
 *   · 通过 → 记 `reviewedShotRev[id]=rev`（定稿，规划器不再纳入）；
 *   · 不合格且未达重试上限 → `reviewAttempts[id]++` + `applyShotRedo`（清图 + rev 自增）→ 回到待生图，
 *     重出后文本+视觉再双审，直到通过或达上限；
 *   · 不合格但已达 `REVIEW_MAX_RETRY` → 记 `reviewedShotRev[id]=rev` 保留当前结果、停止返工（保证收敛，转人工）。
 * 任一侧评审失败（传输/模型异常）按「定稿保留」兜底，避免反复重试坏镜；真的图崩会由模型给出
 * pass=false 触发返工。文本意见仍供 reprompt 改写用。
 */
async function execReviewShots(
  userId: string,
  projectId: string,
  run: ProductionRun,
  view: ProductionRunView,
  shotIds: Array<string>,
): Promise<ExecResult> {
  const reviewed = { ...run.reviewedShotRev };
  const attempts = { ...run.reviewAttempts };
  const revById = new Map(view.shots.map((s) => [s.id, s.rev]));
  const rerollIds: Array<string> = [];
  let passed = 0;
  let exhausted = 0;
  let imageReviewed = 0;

  for (const shotId of shotIds) {
    const rev = revById.get(shotId) ?? 0;
    const shotView = view.shots.find((s) => s.id === shotId);
    const hasImage = shotView?.hasImage ?? false;
    // 人工裁决优先（#2480 · FR-AG-02）：裁决快照与当前 rev 相等才新鲜（有效）——
    // 人通过 → 直接定稿（不花 AI 评审的调用）；人否决 → 判不合格走抽卡重出
    // （rev 抬高后旧裁决自然失效，AI 评审兜底接管）。不新鲜 → AI 双裁判。
    const human = shotView?.humanVerdict ?? null;
    const humanFresh = human !== null && human.rev === rev;
    let pass: boolean;
    if (humanFresh && human.pass) {
      reviewed[shotId] = rev;
      passed++;
      continue;
    }
    if (humanFresh && !human.pass) {
      pass = false;
    } else {
      try {
        const textVerdict = await reviewContent(userId, projectId, "shot", shotId);
        // 视觉裁判：仅镜头已出图时跑（没图就只看文本，退化回旧行为）。
        let imagePass: boolean | null = null;
        if (hasImage) {
          try {
            imagePass = (await reviewShotImage(userId, projectId, shotId)).pass;
            imageReviewed++;
          } catch {
            // 视觉评审传输/模型异常：不阻断、不当作「图没过」，按「未拿到图判据」处理
            // （与文本同口径）—— 真的图崩会由模型给 pass=false 触发返工。
            imagePass = null;
          }
        }
        pass = textVerdict.pass && (imagePass ?? true);
      } catch {
        // 文本评审本身失败：不阻断流水线，按「定稿保留」处理，避免反复重试坏镜。
        reviewed[shotId] = rev;
        continue;
      }
    }
    if (pass) {
      reviewed[shotId] = rev;
      passed++;
    } else if ((attempts[shotId] ?? 0) < REVIEW_MAX_RETRY) {
      attempts[shotId] = (attempts[shotId] ?? 0) + 1;
      rerollIds.push(shotId);
    } else {
      reviewed[shotId] = rev; // 达上限：保留当前结果、定稿，停止返工，转人工
      exhausted++;
    }
  }

  if (rerollIds.length > 0) {
    const fresh = await productionRepository.getForUser(userId, projectId);
    let shots: Array<unknown> = fresh && Array.isArray(fresh.shots) ? fresh.shots : [];
    for (const id of rerollIds) {
      shots = applyShotRedo(shots, id);
    }
    await productionRepository.patchContent(userId, projectId, { shots });
  }

  const parts = [`${passed} 通过`];
  if (rerollIds.length > 0) {
    parts.push(`${rerollIds.length} 抽卡重出`);
  }
  if (exhausted > 0) {
    parts.push(`${exhausted} 达上限保留`);
  }
  if (imageReviewed > 0) {
    parts.push(`${imageReviewed} 已视觉评审`);
  }
  return {
    ok: true,
    summary: `逐镜评审：${parts.join(" / ")}`,
    run: { ...run, reviewedShotRev: reviewed, reviewAttempts: attempts },
  };
}

async function execFilm(
  userId: string,
  projectId: string,
  run: ProductionRun,
): Promise<ExecResult> {
  if (run.filmStartedAt) {
    return { ok: true, skipLog: true, summary: "成片生成中（等待合成完成）" };
  }
  // 服务端直接调成片编排（引擎在服务器上跑，不能用浏览器端的 render-film-client）。
  // createFilmFromProject→start：服务端 watchFilm 逐镜视频 + composeFilm 合成 + syncFilmToProject 回写。
  try {
    const { createFilmFromProject, startFilm } = await import("~/server/film/orchestrator");
    const { id } = await createFilmFromProject({
      userId,
      projectId,
      videoWorkflowId: run.videoWorkflowId || undefined,
      imageWorkflowId: run.imageWorkflowId || undefined,
    });
    await startFilm(id);
  } catch (e: unknown) {
    return { ok: false, error: errorMessage(e, "启动成片失败") };
  }
  return {
    ok: true,
    summary: "已启动成片：服务端逐镜视频 + 合成中",
    run: { ...run, filmStartedAt: nowIso() },
  };
}

/**
 * 推进 run 到下一个停点（等点头 / 完成 / 失败 / 被暂停）。fire-and-forget 调用即可；
 * 内部对每步失败落 failed，不抛给调用方。
 */
export async function advanceRunLoop(userId: string, projectId: string): Promise<void> {
  try {
    for (let tick = 0; tick < MAX_TICKS; tick++) {
      const row = await productionRepository.getForUser(userId, projectId);
      if (!row) {
        return;
      }
      let run = normalizeProductionRun(row.run);
      // 用户暂停 / 取消 / 待确认 / 已收尾 → 引擎让位（编辑改的内容靠 rev 在下次 resume 生效）。
      if (run.status !== "running") {
        return;
      }

      const view = toRunView(row);
      const action = planNextRunAction(view, run);
      if (action.kind === "idle" || action.kind === "await_approval") {
        return;
      }
      if (action.kind === "done") {
        await saveRun(userId, projectId, {
          ...appendRunStep(run, {
            ts: nowIso(),
            kind: "done",
            ok: true,
            detail: "全流程完成，已出片",
          }),
          status: "done",
          awaitingStage: null,
        });
        return;
      }

      let res: ExecResult = { ok: true };
      switch (action.kind) {
        case "generate_script":
          res = await execScript(userId, projectId, run, row);
          break;
        case "review_script":
          res = await execReviewScript(userId, projectId, run, row);
          break;
        case "revise_script":
          res = await execReviseScript(userId, projectId, run);
          break;
        case "extract_characters":
          res = await execCharacters(userId, projectId, row);
          break;
        case "plan_storyboard":
          res = await execStoryboard(userId, projectId, run, row);
          break;
        case "render_images":
          res = await execImages(userId, projectId, run, row, view, action.shotIds);
          break;
        case "review_shots":
          res = await execReviewShots(userId, projectId, run, view, action.shotIds);
          break;
        case "render_film":
          res = await execFilm(userId, projectId, run);
          break;
      }

      if (res.run) {
        run = res.run;
      }
      // 每执行一个动作追加一条执行日志（含成功/失败与产出摘要），随后续 saveRun 落库。
      // 纯等待步（skipLog）不追加，避免出片轮询把日志刷爆。
      if (!res.skipLog) {
        run = appendRunStep(run, {
          ts: nowIso(),
          kind: action.kind,
          ok: res.ok,
          detail: res.ok ? (res.summary ?? actionLabel(action)) : (res.error ?? "失败"),
        });
      }
      if (!res.ok) {
        await saveRun(userId, projectId, {
          ...run,
          status: "failed",
          error: res.error ?? "执行失败",
        });
        return;
      }

      // 出片这一步不 gate：起片后睡一拍再看 rendered（合成完由 syncFilmToProject 回写）。
      if (action.kind === "render_film") {
        await saveRun(userId, projectId, run);
        await sleep(TICK_MS);
        continue;
      }

      const stage = gateStageFor(action) ?? run.stage;
      if (run.approvalMode !== "auto") {
        await saveRun(userId, projectId, {
          ...run,
          stage,
          status: "awaiting_approval",
          awaitingStage: stage,
        });
        return;
      }
      await saveRun(userId, projectId, { ...run, stage });
    }
    // 步数耗尽仍 running → 落 failed，避免僵尸 run。
    const last = await productionRepository.getForUser(userId, projectId);
    const lastRun = normalizeProductionRun(last?.run);
    if (lastRun.status === "running") {
      await saveRun(userId, projectId, {
        ...lastRun,
        status: "failed",
        error: "执行引擎步数超限",
      });
    }
  } catch (e: unknown) {
    try {
      const row = await productionRepository.getForUser(userId, projectId);
      const run = normalizeProductionRun(row?.run);
      if (run.status === "running") {
        await saveRun(userId, projectId, {
          ...run,
          status: "failed",
          error: errorMessage(e, "执行引擎异常"),
        });
      }
    } catch {
      /* 落 failed 也失败：放弃，靠下一次 status 轮询暴露僵尸 run */
    }
  }
}
