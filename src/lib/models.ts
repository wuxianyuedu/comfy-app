import { listModels, listModelFolders } from "./comfyui/client";
import { modelRepository } from "./core/repository";
import type { ModelType } from "./model-types";

export function baseFromName(name: string): string {
  const lower = name.toLowerCase();

  if (lower.includes("illustrious") || lower.includes("sdxl")) {
    return "SDXL";
  }

  if (lower.includes("flux")) {
    return "Flux";
  }

  if (lower.includes("sd1.5") || lower.includes("sd_1.5") || lower.includes("sd15")) {
    return "SD1.5";
  }

  if (lower.includes("pony")) {
    return "Pony";
  }

  return "未知";
}

/* 去掉扩展名，让存储用的 fileName 变成 ComfyUI 能加载的名字。 */
export function stripExt(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

type ScannedFile = {
  baseModel: string;
  fileName: string;
  folder: string;
  name: string;
  type: ModelType;
};

/* 把磁盘上的 ComfyUI 模型同步进本项目的注册表。
 *
 * 所有 ComfyUI 模型目录默认全部启用 —— 这与 ComfyUI 自身的默认状态一致，
 * 不再有「用户挑目录」这一步。目录清单以 ComfyUI 的 `GET /api/models` 为准：
 * 它返回空即视为连不上，库保持为空。
 * 每个目录**就是**它自己的模型类型 —— `Model.type` 的值直接就是目录名原样
 *（不做分类学重映射，也不给每一行加别的类型）。
 * 某个目录的文件只归属于该目录的类型。
 *
 * 返回同步到的模型文件数。
 */
export async function syncModels(): Promise<number> {
  // 第 1 步 —— 无条件退掉所有 LOCAL 行。
  await modelRepository.disableAllLocal();

  // 第 2 步 —— 目录清单同时充当可达性判据：拿不到目录就没有可回填的东西。
  const folders = await listModelFolders();
  if (!folders.length) {
    return 0;
  }

  /* 按目录**并发**拉取：原先是串行 await，目录一个接一个等，总耗时是所有目录
   * 的往返之和。目录数就是模型类型数，并发不会打爆本地 ComfyUI。 */
  const perFolder = await Promise.all(
    folders.map(async (folder) => ({
      folder,
      files: await listModels(folder),
    })),
  );

  const scanned: Array<ScannedFile> = [];
  for (const { folder, files } of perFolder) {
    for (const fileName of files) {
      const name = stripExt(fileName);
      scanned.push({
        folder,
        fileName,
        type: folder,
        name,
        baseModel: baseFromName(name),
      });
    }
  }

  /* 一次性批量落库：模型目录常数百到数千文件，逐条 `await upsertScanned`
   * 就是同数量的数据库往返，同步接口因此长时间挂起。 */
  await modelRepository.upsertScannedMany(scanned);

  return scanned.length;
}

/* 为画布下拉框的并集（P4）查询本地已同步的模型文件名。
 *
 * `folders` 是目录名（它们**就是**模型类型）。所有目录默认启用，因此直接从
 * `Model` 取出去重后的 `fileName`，条件是 `isAvailable=true` 且 `folder` 属于
 * 所请求的目录集合。
 *
 * 重要：返回值是**原样**的（含扩展名）。ComfyUI 的 COMBO 候选就是
 * `/api/models/<folder>` 的原始条目 —— 例如
 * `waiIllustriousSDXL_v170.safetensors` 这样的文件名。
 */
export async function localModelFileNames(folders: Array<string>): Promise<Array<string>> {
  if (!folders.length) {
    return [];
  }
  return modelRepository.listAvailableFileNamesByFolders(folders);
}

/** 每个目录的可用文件数（首页模型概览与模型库目录列共用）。 */
export async function modelCountsByFolder(): Promise<Record<string, number>> {
  return modelRepository.countsByFolder();
}
