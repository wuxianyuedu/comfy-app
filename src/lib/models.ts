import { listModels, comfyBase } from "./comfyui/client";
import { modelRepository, userModelConfigRepository } from "./core/repository";
import { type ModelType } from "./model-types";

export function baseFromName(name: string): string {
  const lower = name.toLowerCase();

  if (lower.includes("illustrious") || lower.includes("sdxl")) return "SDXL";

  if (lower.includes("flux")) return "Flux";

  if (
    lower.includes("sd1.5") ||
    lower.includes("sd_1.5") ||
    lower.includes("sd15")
  )
    return "SD1.5";

  if (lower.includes("pony")) return "Pony";

  return "未知";
}

/* 去掉扩展名，让存储用的 fileName 变成 ComfyUI 能加载的名字。 */
export function stripExt(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

/* 同步流程用来判断「要不要从磁盘重新填充」的健康探测。
 *
 * 它不是整个同步的守卫 —— 每次同步都会**先**退掉所有 LOCAL 行，
 * 因此模型库不会谎称自己与 `UserModelConfig` 同步。
 * 用户一个目录都没配（或全部禁用）时，无论 ComfyUI 通不通，库里都是空的；
 * 这个探测只决定「要不要接着尝试从磁盘回填」。
 */
async function isComfyReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${comfyBase()}/system_stats`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

interface ScannedFile {
  folder: string;
  fileName: string;
  type: ModelType;
  name: string;
  baseModel: string;
}

/* 把磁盘上的 ComfyUI 模型同步进本项目的注册表。
 *
 * 零隐式默认：只访问用户在 `UserModelConfig` 里明确启用的目录。
 * 每个目录**就是**它自己的模型类型 —— `Model.type` 的值直接就是目录名原样
 *（不做分类学重映射，也不给每一行加别的类型）。
 * 某个目录的文件只归属于该目录的类型。
 *
 * 返回同步到的模型文件数。
 */
export async function syncModels(userId?: string): Promise<number> {
  // 解析该用户的「目录 → 是否启用」映射。映射为空说明用户一个目录都没配
  // → 库为空。
  type FolderOverride = { enabled: boolean; isCustom: boolean };
  const overrides = new Map<string, FolderOverride>();
  if (userId) {
    const rows = await userModelConfigRepository.listByUser(userId);
    for (const r of rows) {
      overrides.set(r.folder, { enabled: r.enabled, isCustom: r.isCustom });
    }
  } else {
    // 兼容旧路径（不带用户）：/api/models/sync 已不再走它。
    return 0;
  }

  // 第 1 步 —— 无条件退掉所有 LOCAL 行。
  await modelRepository.disableAllLocal();

  // 第 2 步 —— 只在 ComfyUI 可达时才从磁盘回填。
  if (!(await isComfyReachable())) return 0;

  /* 按目录**并发**拉取：原先是串行 await，目录一个接一个等，总耗时是所有目录
   * 的往返之和。目录数就是模型类型数（十几个），并发不会打爆本地 ComfyUI。 */
  const enabledFolders = [...overrides]
    .filter(([, ov]) => ov.enabled)
    .map(([folder]) => folder);
  const perFolder = await Promise.all(
    enabledFolders.map(async (folder) => ({
      folder,
      files: await listModels(folder),
    })),
  );

  const scanned: ScannedFile[] = [];
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
 * `folders` 是目录名（它们**就是**模型类型）。先匹配 `UserModelConfig` 里
 * `folder` 属于所请求集合的已启用行，再从 `Model` 取出去重后的 `fileName`，
 * 条件是 `isAvailable=true` 且 `folder` 属于这些目录之一。
 *
 * 重要：返回值是**原样**的（含扩展名）。ComfyUI 的 COMBO 候选就是
 * `/api/models/<folder>` 的原始条目 —— 例如
 * `waiIllustriousSDXL_v170.safetensors` 这样的文件名。
 */
export async function localModelFileNames(
  folders: string[],
): Promise<string[]> {
  if (!folders.length) return [];
  const enabled = await userModelConfigRepository.listEnabledFolders();
  const wanted = new Set(folders);
  const matchedFolders = enabled.filter((enabled) => wanted.has(enabled));
  if (!matchedFolders.length) return [];
  return modelRepository.listAvailableFileNamesByFolders(matchedFolders);
}

/** File counts per folder, for the config modal's "文件数" column. */
export async function modelCountsByFolder(): Promise<Record<string, number>> {
  return modelRepository.countsByFolder();
}
