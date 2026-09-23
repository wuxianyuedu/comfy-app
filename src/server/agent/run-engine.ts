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
import {
  completeLLM,
  completeLLMStructured,
  getLLMConfig,
} from "~/lib/llm/server";
import { buildScriptMarkdownMessages } from "~/lib/llm/prompts";
import { synthesizeFirstFrame } from "~/lib/comfyui/firstframe";
import { workshopUid } from "~/lib/workshop/script-parser";
import {
  markActionProcessed,
  normalizeProductionRun,
  planNextRunAction,
  toRunView,
  type ProductionRun,
  type ProductionRunView,
  type RunAction,
} from "~/lib/production/run-types";
import type { ProductionStage } from "~/lib/production/progress";
import { errorMessage } from "~/lib/error-message";
import type { Character, ProjectType, Shot } from "~/lib/workshop/types";
import type { Production } from "~/server/db/schema";

const MAX_TICKS = 240;
const TICK_MS = 4000;
const nowIso = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ExecResult {
  ok: boolean;
  error?: string;
  /** 执行后应写回的 run（多数动作不改 run，返回 undefined 表示沿用原 run）。 */
  run?: ProductionRun;
}

/** 动作 → 完成后要 gate / 推进到的阶段。 */
function gateStageFor(action: RunAction): ProductionStage | null {
  switch (action.kind) {
    case "generate_script":
      return "script";
    case "extract_characters":
      return "character";
    case "plan_storyboard":
      return "storyboard";
    case "render_images":
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
    type: row.type as ProjectType,
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
  const md = (
    await completeLLM(cfg, buildScriptMarkdownMessages(projectMeta(row), idea))
  ).trim();
  if (!md) return { ok: false, error: "模型未返回剧本内容" };
  await productionRepository.patchContent(userId, projectId, {
    scriptMarkdown: md,
  });
  return { ok: true };
}

async function execCharacters(
  userId: string,
  projectId: string,
  row: Production,
): Promise<ExecResult> {
  if (!row.scriptMarkdown.trim())
    return { ok: false, error: "剧本为空，无法提取角色" };
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
  const created: Character[] = briefs
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
  if (created.length === 0) return { ok: false, error: "未从剧本解析出角色" };
  await productionRepository.patchContent(userId, projectId, {
    characters: created,
  });
  return { ok: true };
}

async function execStoryboard(
  userId: string,
  projectId: string,
  row: Production,
): Promise<ExecResult> {
  if (!row.scriptMarkdown.trim())
    return { ok: false, error: "剧本为空，无法规划分镜" };
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
  const shots: Shot[] = items
    .filter((it) => it.description.trim() !== "")
    .map((it, i) => ({
      id: workshopUid("shot"),
      index: i,
      sceneId: "",
      sceneHeading: it.sceneHeading ?? "",
      shotType: (it.shotType ?? "medium") as Shot["shotType"],
      description: it.description,
      characterIds: [],
      prompt: it.description,
      negativePrompt: "",
      params: {},
      status: "idle",
      rev: 0,
    }));
  if (shots.length === 0) return { ok: false, error: "未解析出分镜镜头" };
  await productionRepository.patchContent(userId, projectId, { shots });
  return { ok: true };
}

async function execImages(
  userId: string,
  projectId: string,
  run: ProductionRun,
  row: Production,
  view: ProductionRunView,
  shotIds: string[],
): Promise<ExecResult> {
  if (!run.imageWorkflowId) {
    return {
      ok: false,
      error: "缺少图类工作流（imageWorkflowId），无法逐镜生图",
    };
  }
  const shots = Array.isArray(row.shots) ? (row.shots as Shot[]) : [];
  const want = new Set(shotIds);
  const next: Shot[] = [];
  for (const shot of shots) {
    if (!want.has(shot.id)) {
      next.push(shot);
      continue;
    }
    try {
      const path = await synthesizeFirstFrame({
        userId,
        workflowId: run.imageWorkflowId,
        prompt: shot.prompt,
        negative: shot.negativePrompt || undefined,
        projectId,
      });
      next.push({ ...shot, imageUrl: path, status: "done" });
    } catch {
      // 单镜失败：记为 failed，不阻断其它镜；已处理 rev 仍写，避免无限重试同一坏镜。
      next.push({ ...shot, status: "failed" });
    }
  }
  await productionRepository.patchContent(userId, projectId, { shots: next });
  // 记录这些镜头「已按当前 rev 处理」——用户之后再改（rev 变大）会被重新纳入。
  return {
    ok: true,
    run: markActionProcessed(run, view, { kind: "render_images", shotIds }),
  };
}

async function execFilm(
  userId: string,
  projectId: string,
  run: ProductionRun,
): Promise<ExecResult> {
  if (run.filmStartedAt) return { ok: true }; // 已起片，等 rendered
  // 服务端直接调成片编排（引擎在服务器上跑，不能用浏览器端的 render-film-client）。
  // createFilmFromProject→start：服务端 watchFilm 逐镜视频 + composeFilm 合成 + syncFilmToProject 回写。
  try {
    const { createFilmFromProject, startFilm } =
      await import("~/server/film/orchestrator");
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
  return { ok: true, run: { ...run, filmStartedAt: nowIso() } };
}

/**
 * 推进 run 到下一个停点（等点头 / 完成 / 失败 / 被暂停）。fire-and-forget 调用即可；
 * 内部对每步失败落 failed，不抛给调用方。
 */
export async function advanceRunLoop(
  userId: string,
  projectId: string,
): Promise<void> {
  try {
    for (let tick = 0; tick < MAX_TICKS; tick++) {
      const row = await productionRepository.getForUser(userId, projectId);
      if (!row) return;
      let run = normalizeProductionRun(row.run);
      // 用户暂停 / 取消 / 待确认 / 已收尾 → 引擎让位（编辑改的内容靠 rev 在下次 resume 生效）。
      if (run.status !== "running") return;

      const view = toRunView(row);
      const action = planNextRunAction(view, run);
      if (action.kind === "idle" || action.kind === "await_approval") return;
      if (action.kind === "done") {
        await saveRun(userId, projectId, {
          ...run,
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
        case "extract_characters":
          res = await execCharacters(userId, projectId, row);
          break;
        case "plan_storyboard":
          res = await execStoryboard(userId, projectId, row);
          break;
        case "render_images":
          res = await execImages(
            userId,
            projectId,
            run,
            row,
            view,
            action.shotIds,
          );
          break;
        case "render_film":
          res = await execFilm(userId, projectId, run);
          break;
      }

      if (res.run) run = res.run;
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
