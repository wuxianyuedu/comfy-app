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
import type { LoraTrainingJob } from "~/server/db/schema";
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

/** datasetImages 里的单条形状（与 TrainJobSpec 中内联声明一致）。 */
type DatasetImage = TrainJobSpec["datasetImages"][number];

/** caption 已确认是非空字符串的子形状（供 filter 的类型谓词使用）。 */
type CaptionedImage = DatasetImage & { caption: string };

/**
 * 类型谓词：`caption?.trim()` 之后仍为真 → caption 存在且去空白非空。
 *
 * filter 用内联箭头返回 boolean 不会窄化元素类型，`map` 里 `item.caption`
 * 仍被 TS 判为可选、只能靠 `!` 兜住。用显式谓词把「caption 非空」这一
 * 判据在类型层落住，判据与用法只此一份；改判据忘了同步 `!`（或反过来）
 * 的分叉机会消掉。
 */
function hasNonEmptyCaption(item: DatasetImage): item is CaptionedImage {
  return !!item.caption?.trim();
}

/**
 * LoraTrainingJob 的 DB 行 → 后端契约 TrainJobSpec 的**唯一**归一化。
 *
 * 取代原来 caller 里那句 `job as unknown as TrainJobSpec` 双跳断言。那一行
 * 吞掉了三类漂移：
 *   · schema 多出来的列（`userId` / `status` / `progress` / `outputName` /
 *     `logs` / `error` / `createdAt` / `updatedAt`）会被 `JSON.stringify(spec)`
 *     **原样**发给训练后端 —— 后端多解一步就多一处可能踩坑，也让「DB 加
 *     一列」在这条通道上变成一次未审计的 API 变更；
 *   · `classWord: string | null`（DB）与 `classWord?: string`（契约）语义
 *     并不相同：前者是「显式 null」、后者是「不提供」，盲 cast 让下游按
 *     undefined 判的代码读到 null；
 *   · `datasetImages` 是 JSON 列（`mode: "json"`），Drizzle 侧类型是 unknown，
 *     历史上真出现过「只存了文件名数组」的老行形状。
 *
 * 归一化后，schema 与契约的对齐变成**编译器 + 一处判据**的责任：TrainJobSpec
 * 加字段忘了在 toTrainJobSpec 里给值 → `tsc` 立刻报缺属性；运行时形状不符 →
 * 归一化到合法形状或退化到 []，不再让「发上去什么形状，后端就得到什么形状」。
 */
function toTrainJobSpec(job: LoraTrainingJob): TrainJobSpec {
  return {
    id: job.id,
    name: job.name,
    baseModel: job.baseModel,
    triggerWord: job.triggerWord,
    // DB 的 `string | null` 归到契约的 `?: string`：null 视为「不提供」，
    // 避免 JSON.stringify 把 `"classWord": null` 发下去、后端按 undefined 判
    // 的代码读到 null。
    ...(job.classWord != null ? { classWord: job.classWord } : {}),
    datasetImages: normalizeDatasetImages(job.datasetImages),
    // captions 由 caller 在 datasetImages 摊平之后填进来，这里不猜。
    resolution: job.resolution,
    steps: job.steps,
    batchSize: job.batchSize,
    learningRate: job.learningRate,
    rankDim: job.rankDim,
    networkAlpha: job.networkAlpha,
    optimizer: job.optimizer,
    scheduler: job.scheduler,
    seed: job.seed,
  };
}

/**
 * `datasetImages` 是 JSON 列，Drizzle 给到的是 `unknown`。判据**故意宽**：
 *   · 数组项是字符串 → 视作 `{ name: 那串 }`（历史老行只存了文件名）；
 *   · 数组项是对象且 `name` 是 string → 按 `{ name; caption? }` 收下，
 *     `caption` 非 string 就丢，不给后端凑一份「未知形状」；
 *   · 其他项 → 丢弃（缺 name 的条目下游按 name 索引就是没锚点）。
 * 整体不是数组 / 是 null → 退化成 `[]`：后端拿空数组会明确拒绝执行、报
 * 「没有可训练数据」，比让它拿到 undefined 或半成品 payload 好排查。
 */
function normalizeDatasetImages(raw: unknown): DatasetImage[] {
  if (!Array.isArray(raw)) return [];
  const out: DatasetImage[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      out.push({ name: item });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const name = (item as { name?: unknown }).name;
    if (typeof name !== "string") continue;
    const caption = (item as { caption?: unknown }).caption;
    out.push(typeof caption === "string" ? { name, caption } : { name });
  }
  return out;
}

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

  const spec = toTrainJobSpec(job);
  // 把逐图说明摊平成「文件名 → 说明」映射，供需要它的后后端使用
  //（说明同时也随 datasetImages 一起带过去）。
  spec.captions = Object.fromEntries(
    spec.datasetImages
      .filter(hasNonEmptyCaption)
      .map((item) => [item.name, item.caption.trim()]),
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
