// LoRA 训练编排器（炼丹）。
//
// 本地优先的设计：训练任务先写进数据库，再由本模块驱动。两种模式：
//
//  1. 接了真实后端（生产环境推荐）：
//     把 LORA_TRAINER_URL 指向你的训练服务（Kohya / OneTrainer，
//     或某个暴露 HTTP 接口的 ComfyUI 训练节点）。我们 POST 任务描述，
//     然后轮询状态直到终态。成功时后端应当已把最终的 `.safetensors` 写进
//     ComfyUI 的 loras 目录（或 COMFY_LORAS_DIR 指定的目录）；
//     我们随后登记一条 Model 记录，让这个 LoRA 出现在选择器 / 模型库里可用。
//
//  2. 没配后端（全新安装的默认情形）：
//     任务保持 QUEUED，并留一条说明性日志。界面显示
//     「训练后端未配置」的横幅与配置指引。这与 ComfyUI 离线时视频流水线的
//     行为一致 —— 如实告知，不做假象。
//
// 后端契约（模式 1）：
//   POST  {LORA_TRAINER_URL}/train      请求体是 TrainJobSpec，返回 { id }（任务 id）
//   GET   {LORA_TRAINER_URL}/train/:id  返回 status / progress / logs / outputName 等
//     其中 status 为 "running" / "done" / "failed" 三选一。
//   状态变成 "done" 时，`outputName` 就是已经放进 ComfyUI loras 目录的
//   .safetensors 文件名。

import "server-only";
import { safeDisplayName } from "~/lib/safe-name";
import { loraTrainingJobRepository, modelRepository } from "../core/repository";
import { promises as fs } from "fs";
import path from "path";
import { getSettingsSync } from "../app-settings/app-settings.server";
import { sleep } from "~/lib/with-timeout";

function trainerUrl(): string {
  const settings = getSettingsSync();

  return (settings.trainerUrl || (process.env.LORA_TRAINER_URL ?? "")).replace(
    /\/$/,
    "",
  );
}

function comfyLorasDir(): string {
  const settings = getSettingsSync();

  return (
    settings.comfyLorasDir ||
    (process.env.COMFY_LORAS_DIR ?? path.join(process.cwd(), "models", "loras"))
  );
}

export type TrainLogEntry = {
  t: number;
  level: "info" | "progress" | "warn" | "error" | "success";
  msg: string;
};

export type TrainJobSpec = {
  id: string;
  name: string;
  baseModel: string;
  triggerWord: string;
  classWord?: string;
  datasetImages: { name: string; caption?: string }[];
  captions?: Record<string, string>;
  resolution: number;
  steps: number;
  batchSize: number;
  learningRate: number;
  rankDim: number;
  networkAlpha: number;
  optimizer: string;
  scheduler: string;
  seed: number;
};

export function isTrainerConfigured(): boolean {
  return trainerUrl().length > 0;
}

async function appendLog(
  jobId: string,
  level: TrainLogEntry["level"],
  msg: string,
) {
  await loraTrainingJobRepository.appendLog(jobId, {
    t: Date.now(),
    level,
    msg,
  });
}

/* 启动一个训练任务。发完即忘（与生成执行器同一套路子），
 * 从请求处理器里调用是安全的。 */
export async function enqueueTraining(jobId: string): Promise<void> {
  const job = await loraTrainingJobRepository.findById(jobId);
  if (!job) return;

  const spec = job as unknown as TrainJobSpec;
  // 把逐图说明摊平成「文件名 → 说明」映射，供需要它的后后端使用
  //（说明同时也随 datasetImages 一起带过去）。
  spec.captions = Object.fromEntries(
    (spec.datasetImages ?? [])
      .filter((item) => item?.caption?.trim())
      .map((item) => [item.name, item.caption!.trim()]),
  );

  if (!trainerUrl()) {
    await appendLog(
      jobId,
      "warn",
      "训练后端未配置：在「设置 → 偏好」中填写训练后端 URL（如 Kohya / OneTrainer / ComfyUI 训练节点的 HTTP 地址）后即开始真实训练。任务已暂存。",
    );
    return; // stays QUEUED
  }

  await appendLog(jobId, "info", `已提交至训练后端 ${trainerUrl()}`);
  void runRemote(spec).catch((e: unknown) => {
    // e 可能是任意 throw 值：先收窄再取 message（与旧 `e?.message ?? …` 等价，
    // fetch/undici 抛的都是 Error 实例）。
    const msg = (e as Error | undefined)?.message ?? "训练后端通信失败";
    void failJob(jobId, msg);
  });
}

async function runRemote(spec: TrainJobSpec): Promise<void> {
  const base = trainerUrl();
  const res = await fetch(`${base}/train`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(spec),
  });
  if (!res.ok) throw new Error(`训练后端返回 ${res.status}`);
  const data = (await res.json()) as { id?: string };
  const backendId = data.id ?? spec.id;

  await loraTrainingJobRepository.markRunning(spec.id);

  // 轮询到终态为止。
  const POLL_MS = 4000;
  for (;;) {
    await sleep(POLL_MS);
    const st = await fetch(`${base}/train/${encodeURIComponent(backendId)}`);
    if (!st.ok) throw new Error(`训练状态查询失败 ${st.status}`);
    const info = (await st.json()) as {
      status: "running" | "done" | "failed";
      progress?: number;
      logs?: { level: TrainLogEntry["level"]; msg: string }[];
      outputName?: string;
    };

    if (Array.isArray(info.logs)) {
      for (const l of info.logs) await appendLog(spec.id, l.level, l.msg);
    }
    if (typeof info.progress === "number") {
      await loraTrainingJobRepository.updateProgress(spec.id, info.progress);
    }

    if (info.status === "done") {
      await finishJob(spec, info.outputName);
      return;
    }
    if (info.status === "failed") {
      await failJob(spec.id, "训练后端报告失败");
      return;
    }
  }
}

async function finishJob(
  spec: TrainJobSpec,
  outputName?: string,
): Promise<void> {
  const finalName =
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    outputName || `${safeDisplayName(spec.name)}_r${spec.rankDim}.safetensors`;

  // 登记一条 Model 记录，让这个 LoRA 出现在选择器 / 模型库里。
  //（前提是后端已经把它写进 ComfyUI 的 loras 目录。）
  await modelRepository.registerLora({
    fileName: finalName,
    name: spec.name,
    baseModel: spec.baseModel,
    triggerWord: spec.triggerWord,
  });

  await loraTrainingJobRepository.markDone(spec.id, finalName);
  await appendLog(
    spec.id,
    "success",
    `训练完成，LoRA 已产出：${finalName}（可在创作台 LoRA 中选择使用）`,
  );
}

async function failJob(jobId: string, error: string): Promise<void> {
  await loraTrainingJobRepository.markFailed(jobId, error);
  await appendLog(jobId, "error", `训练失败：${error}`);
}

export async function cancelTraining(jobId: string): Promise<void> {
  const job = await loraTrainingJobRepository.findStatusById(jobId);
  if (!job) return;
  if (
    job.status === "DONE" ||
    job.status === "FAILED" ||
    job.status === "CANCELLED"
  )
    return;

  if (trainerUrl()) {
    try {
      await fetch(`${trainerUrl()}/train/${encodeURIComponent(jobId)}`, {
        method: "DELETE",
      });
    } catch {
      /* best-effort */
    }
  }
  await loraTrainingJobRepository.markCancelled(jobId);
  await appendLog(jobId, "warn", "用户已取消训练任务");
}

// 保留对 `fs` 的引用（将来本地后端拷贝文件要用），以满足 lint，
// 避免以后加本地路径时冒出未使用导入的错误。
void fs;
void comfyLorasDir;
