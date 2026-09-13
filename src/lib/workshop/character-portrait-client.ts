// ── 角色定妆照：生成 / 导入的网络层（规范 17 §17.2 第②层）──────────────────
// 三条链路都是既有的，这里只做「按定妆照语义组装参数 + 把结果归一成一条候选地址」：
//   · 本地：内置 txt2img → tRPC generate.generate → SSE 任务流（与镜头生图同链路）
//   · 远端：/api/workshop-api/generate 的 image 通道（OpenAI 兼容 images/generations）
//   · 导入：素材库「角色」分类（/api/materials），落盘后拿到可引用的本地地址

import { uploadMaterialItem } from "@/lib/materials-client";
import type { SavedOutput } from "./api-channel-shared";
import {
  apiGenerateImage,
  startLocalGenerate,
  watchTask,
  type GenerateInput,
  type TaskLogEntry,
} from "./generation-client";

/** 定妆照生成请求：提示词直接取角色卡的正 / 负向提示词，模型与尺寸由调用方给。 */
export interface PortraitRequest {
  prompt: string;
  negative?: string;
  /** "宽x高"，如 "768x1024" */
  size: string;
}

/** 本机链路的进展回调（进度 + 执行日志）。 */
export interface LocalPortraitHandlers {
  onProgress?: (pct: number) => void;
  onLog?: (entry: TaskLogEntry) => void;
}

function strParam(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value : fallback;
}

function numParam(value: unknown, fallback: number): number {
  const num =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(num) ? num : fallback;
}

/** 角色卡推荐参数（Skill 默认值）→ 内置 txt2img 输入；缺项用与镜头生图相同的缺省。 */
function buildLocalPortraitInput(
  req: PortraitRequest,
  opts: { checkpoint: string; params?: Record<string, unknown> },
): GenerateInput {
  const params = opts.params ?? {};
  return {
    workflow: "txt2img",
    prompt: req.prompt,
    negative: req.negative,
    checkpoint: opts.checkpoint || undefined,
    steps: Math.round(numParam(params.steps, 28)),
    cfg: numParam(params.cfg, 7),
    sampler: strParam(params.sampler, "euler_ancestral"),
    scheduler: strParam(params.scheduler, "normal"),
    size: req.size,
    count: 1,
  };
}

/** 本机通道生成一张定妆照：提交任务并等它跑完，返回任务 id 与产物地址。 */
export async function generateLocalPortrait(
  req: PortraitRequest,
  opts: { checkpoint: string; params?: Record<string, unknown> },
  handlers: LocalPortraitHandlers = {},
): Promise<{ taskId: string; url: string }> {
  const taskId = await startLocalGenerate(buildLocalPortraitInput(req, opts));
  const url = await new Promise<string>((resolve, reject) => {
    let imageUrl = "";
    watchTask(taskId, {
      onProgress: (pct) => handlers.onProgress?.(pct),
      onLog: (entry) => handlers.onLog?.(entry),
      onOutput: (output: SavedOutput) => {
        if (output.kind !== "video" && !imageUrl) imageUrl = output.url;
      },
      onSettled: (result) => {
        if (!result.ok) reject(new Error(result.message ?? "定妆照生成失败"));
        else if (imageUrl) resolve(imageUrl);
        else reject(new Error("任务完成但没有产出图片"));
      },
    });
  });
  return { taskId, url };
}

/** MIME → 落盘扩展名（服务端按扩展名判素材种类；未知类型统一按 png 存）。 */
const DATA_URL_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/avif": "avif",
};

/** data URL → File（浏览器侧同源读取内联图片，不涉及跨域）。 */
async function dataUrlToFile(dataUrl: string, name: string): Promise<File> {
  const blob = await (await fetch(dataUrl)).blob();
  // 服务端按扩展名归属素材种类，没有扩展名会被当成文档，故这里必须有兜底后缀。
  const ext = DATA_URL_EXTENSIONS[blob.type] ?? "png";
  return new File([blob], `${name}.${ext}`, { type: blob.type || "image/png" });
}

/** 远端通道常返回内联 b64（data URL）：这种地址进草稿会把 localStorage 与
 *  服务端镜像一起撑爆，故先落成素材库文件再返回本地地址；远端 http 地址原样返回
 *  （浏览器侧跨域拿不到，引用时由服务端自行拉取）。 */
async function localizePortraitImage(
  url: string,
  opts: { projectId: string; name: string },
): Promise<string> {
  if (!url.startsWith("data:")) return url;
  const file = await dataUrlToFile(url, opts.name);
  const item = await uploadMaterialItem(file, {
    folder: "characters",
    projectId: opts.projectId,
  });
  return item.url;
}

/** 远端 API 通道生成一张定妆照，返回可引用的地址。
 *  opts.model 传设置页「远端模型」（kind=image）的名字：按该条目的连接参数
 *  直连生图，不必再配一份工坊 API 通道；不传则走旧通道设置。 */
export async function generateRemotePortrait(
  req: PortraitRequest,
  opts: { projectId: string; name: string; model?: string },
): Promise<string> {
  const url = await apiGenerateImage({
    prompt: req.prompt,
    negative: req.negative,
    size: req.size,
    ...(opts.model ? { model: opts.model } : {}),
  });
  return localizePortraitImage(url, opts);
}

/** 外部导入现成的定妆照：写进素材库「角色」分类并返回地址。 */
export async function importPortraitFile(
  file: File,
  opts: { projectId: string },
): Promise<string> {
  const item = await uploadMaterialItem(file, {
    folder: "characters",
    projectId: opts.projectId,
  });
  return item.url;
}
