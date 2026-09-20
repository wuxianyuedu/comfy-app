// ── 角色定妆照：生成 / 导入的网络层（规范 17 §17.2 第②层）──────────────────
// 三条链路都是既有的，这里只做「按定妆照语义组装参数 + 把结果归一成一条候选地址」：
//   · 本地：工作流库工作流 → tRPC generate.generate → SSE 任务流（与镜头生图同链路）
//   · 远端：/api/workshop-api/generate 的 image 通道（OpenAI 兼容 images/generations）
//   · 导入：素材库「角色」分类（/api/materials），落盘后拿到可引用的本地地址

import { isInlineMedia } from "~/lib/media/data-url";
import { DEFAULT_IMAGE_MIME, extForMime } from "~/lib/media/mime-ext";
import { uploadMaterialItem } from "~/lib/media/materials-client";
import {
  sizeSpecToRelay,
  sizeSpecToWxH,
  type SizeSpec,
} from "~/lib/media/size-presets";
import type { SavedOutput } from "./api-channel-shared";
import {
  apiGenerateImage,
  buildLibraryWorkflowInput,
  startLocalGenerate,
  watchTask,
  type TaskLogEntry,
} from "./generation-client";

/** 定妆照生成请求：提示词直接取角色卡的正 / 负向提示词，模型与尺寸由调用方给。
 *
 *  尺寸给的是**尺寸表达**（比例 + 分辨率 / 比例 + 百万像素 + 倍数，见
 *  `lib/size-presets`），不是 "WxH" 字符串：两条通道各自要的形状由本层现算
 *  （远端要「比例 + 百万像素」、库工作流直接吃尺寸表达）。 */
export interface PortraitRequest {
  prompt: string;
  negative?: string;
  size: SizeSpec;
}

/** 本机链路的进展回调（进度 + 执行日志）。 */
export interface LocalPortraitHandlers {
  onProgress?: (pct: number) => void;
  onLog?: (entry: TaskLogEntry) => void;
}

/** 本地通道生成一张定妆照：按对外参数封装（提示词 / 尺寸，其余走默认值）
 *  组装输入并提交本地 ComfyUI，返回任务 id 与产物地址。
 *  工作流库里配置好对外参数的工作流，在角色卡本地通道像远端模型一样被选择。 */
export async function generateWorkflowPortrait(
  req: PortraitRequest,
  opts: { workflowId: string },
  handlers: LocalPortraitHandlers = {},
): Promise<{ taskId: string; url: string }> {
  /* 库工作流吃尺寸表达（比例 + 档位 [+ 倍数]）：宽高由封装层按场景表现算，
   *  不再下发 "WxH" 兼容字段。 */
  const { input } = await buildLibraryWorkflowInput(opts.workflowId, {
    prompt: req.prompt,
    ...(req.negative !== undefined ? { negativePrompt: req.negative } : {}),
    size: req.size,
  });
  const taskId = await startLocalGenerate(input);
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

/* 未知 MIME 的兜底后缀：素材库按扩展名归属种类，没有后缀会被判成文档。 */
const DEFAULT_EXT = "png";

/** data URL → File（浏览器侧同源读取内联图片，不涉及跨域）。 */
async function dataUrlToFile(dataUrl: string, name: string): Promise<File> {
  /* 「这是不是一个内联 media」走 `~/lib/media/data-url`（规范 16 §16.2.4.56）；
   * 解码本身交给 `fetch`（浏览器原生，不必自己 base64 → Blob）。 */
  if (!isInlineMedia(dataUrl)) throw new Error("data URL 格式无效");
  const blob = await (await fetch(dataUrl)).blob();
  /* 服务端按扩展名归属素材种类，没有扩展名会被当成文档，故这里必须有兜底后缀。 */
  const ext = extForMime(blob.type) ?? DEFAULT_EXT;
  return new File([blob], `${name}.${ext}`, {
    type: blob.type || DEFAULT_IMAGE_MIME,
  });
}

/** 远端通道常返回内联 b64（data URL）：这种地址进草稿会把 localStorage 与
 *  服务端镜像一起撑爆，故先落成素材库文件再返回本地地址；远端 http 地址原样返回
 *  （浏览器侧跨域拿不到，引用时由服务端自行拉取）。 */
async function localizePortraitImage(
  url: string,
  opts: { projectId: string; name: string },
): Promise<string> {
  if (!isInlineMedia(url)) return url;
  const file = await dataUrlToFile(url, opts.name);
  const item = await uploadMaterialItem(file, {
    folder: "characters",
    projectId: opts.projectId,
  });
  return item.url;
}

/** 远端 API 通道生成一张定妆照，返回可引用的地址。
 *  opts.model 传设置页「远端模型」（kind=image）的名字：按该条目的连接参数
 *  直连生图，不必再配一份工坊 API 通道；不传则走旧通道设置。
 *  尺寸按请求里的尺寸表达现算：远端认「比例 + 百万像素 + 倍数」，另外保留
 *  `size`（"WxH"）给只读字符串的老接口。 */
export async function generateRemotePortrait(
  req: PortraitRequest,
  opts: {
    projectId: string;
    name: string;
    model?: string;
  },
): Promise<string> {
  const url = await apiGenerateImage({
    prompt: req.prompt,
    negative: req.negative,
    size: sizeSpecToWxH(req.size),
    ...(opts.model ? { model: opts.model } : {}),
    mode: "T2I",
    /* 远端通道认「宽高比 + 百万像素」：分辨率档按场景尺寸表换算成实际总像素。 */
    ...sizeSpecToRelay(req.size),
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
