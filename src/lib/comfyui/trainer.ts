// LoRA training orchestrator (炼丹).
//
// Local-first design: a training job is created in the DB, then this module
// drives it. Two modes:
//
//  1. Real backend (recommended for production):
//     Set LORA_TRAINER_URL to your trainer service (Kohya / OneTrainer /
//     a ComfyUI training node exposing an HTTP API). We POST the job spec,
//     then poll status until terminal. On success the backend is expected to
//     have written the final `.safetensors` into the ComfyUI loras folder
//     (or the dir given by COMFY_LORAS_DIR); we then register a Model row so
//     the LoRA shows up in the selector / model library and can be used.
//
//  2. No backend configured (default in a fresh install):
//     The job is kept QUEUED with a clear informational log. The UI shows a
//     "训练后端未配置" banner with setup instructions. This mirrors how the
//     video pipeline behaves when ComfyUI is offline — honest, not faked.
//
// Backend contract (mode 1):
//   POST  {LORA_TRAINER_URL}/train      body: TrainJobSpec  -> { id: string }
//   GET   {LORA_TRAINER_URL}/train/:id  -> { status, progress, logs?, outputName? }
//     status: "running" | "done" | "failed"
//   On "done", `outputName` is the .safetensors filename already placed in the
//   ComfyUI loras directory.

import { prisma } from "../db";
import { promises as fs } from "fs";
import path from "path";
import { getSettingsSync } from "../app-settings";

function trainerUrl(): string {
  const s = getSettingsSync();
  return (s.trainerUrl || process.env.LORA_TRAINER_URL || "").replace(/\/$/, "");
}

function comfyLorasDir(): string {
  const s = getSettingsSync();
  return s.comfyLorasDir || process.env.COMFY_LORAS_DIR || path.join(process.cwd(), "models", "loras");
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

async function appendLog(jobId: string, level: TrainLogEntry["level"], msg: string) {
  const job = await prisma.loraTrainingJob.findUnique({ where: { id: jobId }, select: { logs: true } });
  const arr = (job?.logs as TrainLogEntry[] | null) ?? [];
  arr.push({ t: Date.now(), level, msg });
  await prisma.loraTrainingJob.update({
    where: { id: jobId },
    data: { logs: arr as any, updatedAt: new Date() },
  });
}

/**
 * Kick off a training job. Fire-and-forget (same pattern as the generation
 * runner). Safe to call from a request handler.
 */
export async function enqueueTraining(jobId: string): Promise<void> {
  const job = await prisma.loraTrainingJob.findUnique({ where: { id: jobId } });
  if (!job) return;

  const spec = job as unknown as TrainJobSpec;
  // Flatten per-image captions into a filename→caption map for backends that
  // expect it (the caption also rides along inside datasetImages).
  spec.captions = Object.fromEntries(
    (spec.datasetImages ?? [])
      .filter((d) => d?.caption && d.caption.trim())
      .map((d) => [d.name, d.caption!.trim()])
  );

  if (!trainerUrl()) {
    await appendLog(
      jobId,
      "warn",
      "训练后端未配置：在「设置 → 偏好」中填写训练后端 URL（如 Kohya / OneTrainer / ComfyUI 训练节点的 HTTP 地址）后即开始真实训练。任务已暂存。"
    );
    return; // stays QUEUED
  }

  await appendLog(jobId, "info", `已提交至训练后端 ${trainerUrl()}`);
  void runRemote(spec).catch((e: any) => {
    void failJob(jobId, e?.message ?? "训练后端通信失败");
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

  await prisma.loraTrainingJob.update({
    where: { id: spec.id },
    data: { status: "RUNNING", progress: 0 },
  });

  // Poll until terminal.
  const POLL_MS = 4000;
  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_MS));
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
      await prisma.loraTrainingJob.update({
        where: { id: spec.id },
        data: { progress: Math.min(100, Math.max(0, info.progress)), status: "RUNNING" },
      });
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

async function finishJob(spec: TrainJobSpec, outputName?: string): Promise<void> {
  const finalName =
    outputName ||
    `${spec.name.replace(/[^\w一-龥-]+/g, "_")}_r${spec.rankDim}.safetensors`;

  // Register a Model row so the LoRA appears in the selector / library.
  // (Assumes the backend already wrote finalName into the ComfyUI loras dir.)
  await prisma.model.upsert({
    where: { fileName: finalName },
    update: { isAvailable: true, name: spec.name, baseModel: spec.baseModel },
    create: {
      name: spec.name,
      type: "LORA",
      fileName: finalName,
      baseModel: spec.baseModel,
      category: "USER",
      source: "LOCAL",
      isAvailable: true,
      description: `由炼丹训练产出 · 触发词 ${spec.triggerWord}`,
    },
  });

  await prisma.loraTrainingJob.update({
    where: { id: spec.id },
    data: { status: "DONE", progress: 100, outputName: finalName, updatedAt: new Date() },
  });
  await appendLog(spec.id, "success", `训练完成，LoRA 已产出：${finalName}（可在创作台 LoRA 中选择使用）`);
}

async function failJob(jobId: string, error: string): Promise<void> {
  await prisma.loraTrainingJob.update({
    where: { id: jobId },
    data: { status: "FAILED", error, updatedAt: new Date() },
  });
  await appendLog(jobId, "error", `训练失败：${error}`);
}

export async function cancelTraining(jobId: string): Promise<void> {
  const job = await prisma.loraTrainingJob.findUnique({ where: { id: jobId }, select: { status: true } });
  if (!job) return;
  if (job.status === "DONE" || job.status === "FAILED" || job.status === "CANCELLED") return;

  if (trainerUrl()) {
    try {
      await fetch(`${trainerUrl()}/train/${encodeURIComponent(jobId)}`, { method: "DELETE" });
    } catch {
      /* best-effort */
    }
  }
  await prisma.loraTrainingJob.update({
    where: { id: jobId },
    data: { status: "CANCELLED", updatedAt: new Date() },
  });
  await appendLog(jobId, "warn", "用户已取消训练任务");
}

// Keep `fs` referenced (used by future local-backend file copy) to satisfy
// lint and avoid unused-import errors if a local path is added later.
void fs;
void comfyLorasDir;
