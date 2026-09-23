// 从统一项目一键渲染成片的能力层（Phase 5 agent 工具 / 设计 §8 P5）。
//
// 走已建好的服务端成片管线：`film.createFromProject`（读项目 production.shots 建片）
// → `film.start`（服务端 watchFilm 逐镜生成视频 + composeFilm ffmpeg 合成，完成后
// syncFilmToProject 把逐镜 clip 与项目进度回写）。**不轮询** —— 服务端自动跑完，
// 工坊 / 画布共读同一份 production 进度（#892/#894）。这里只负责「触发 + 前置校验」，
// 让 Agent 具备真正的「视频 / 合成」端到端能力，而不是像生图那样回退到手动。
//
// 放 src/lib/<domain>-client 层，视图 / hook 不经手 tRPC（对齐 §17）。
import { vanillaApi } from "~/trpc/vanilla";

export interface RenderFilmInput {
  /** 目标统一项目 id（proj_*）；无活跃项目传 null。 */
  projectId: string | null;
  /** 逐镜生成视频用的工作流库视频工作流 id（本地链路唯一来源）。 */
  videoWorkflowId?: string;
  /** 文生视频镜头合成首帧用的图类工作流 id（可选）。 */
  imageWorkflowId?: string;
}

export interface RenderFilmResult {
  ok: boolean;
  summary: string;
  detail?: string;
}

/** 用当前项目的镜头触发一键成片（服务端逐镜生成视频 + 合成 + 回写进度）。 */
export async function renderProjectFilm(
  input: RenderFilmInput,
): Promise<RenderFilmResult> {
  if (!input.projectId) {
    return { ok: false, summary: "当前没有活跃项目，无法成片" };
  }
  if (!input.videoWorkflowId) {
    return {
      ok: false,
      summary: "请先在工坊选择「视频工作流」（逐镜生成视频的唯一来源）",
    };
  }
  try {
    const { id } = await vanillaApi.film.createFromProject.mutate({
      projectId: input.projectId,
      videoWorkflowId: input.videoWorkflowId,
      ...(input.imageWorkflowId
        ? { imageWorkflowId: input.imageWorkflowId }
        : {}),
    });
    await vanillaApi.film.start.mutate({ id });
    return {
      ok: true,
      summary:
        "已启动成片：将按项目镜头逐镜生成视频并合成，完成后自动更新项目进度",
      detail: id,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, summary: "启动成片失败", detail: msg };
  }
}
