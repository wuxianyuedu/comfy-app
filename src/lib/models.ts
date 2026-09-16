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

/** Strip extension so a stored fileName becomes the loadable ComfyUI name. */
export function stripExt(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

/**
 * Health probe used by the sync to decide whether to re-fill from disk.
 *
 * Not a guard around the whole sync — every sync first retires LOCAL rows
 * so the library cannot lie about being out of sync with `UserModelConfig`.
 * When the user has zero configured folders (or has disabled them all) the
 * library reads empty regardless of ComfyUI connectivity; the probe only
 * controls whether we then attempt to refill from disk.
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

/**
 * Sync the on-disk ComfyUI models into our registry.
 *
 * (zero-implicit-default): only folders the user has explicitly
 * enabled in `UserModelConfig` are visited. each directory IS its
 * own model type — the `Model.type` value is simply the directory name
 * verbatim (no taxonomy remapping, no per-row extra types).  A directory's
 * files are attributed only to that directory's type.
 *
 * Returns the number of model files synced.
 */
export async function syncModels(userId?: string): Promise<number> {
  // Resolve the (folder → enabled) map for this user.  An empty override map
  // means the user has zero folders configured → empty library.
  type FolderOverride = { enabled: boolean; isCustom: boolean };
  const overrides = new Map<string, FolderOverride>();
  if (userId) {
    const rows = await userModelConfigRepository.listByUser(userId);
    for (const r of rows) {
      overrides.set(r.folder, { enabled: r.enabled, isCustom: r.isCustom });
    }
  } else {
    // Legacy path (no user): not used by /api/models/sync.
    return 0;
  }

  // STEP 1 — unconditionally retire every LOCAL row.
  await modelRepository.disableAllLocal();

  // STEP 2 — re-fill from disk only if ComfyUI is reachable.
  if (!(await isComfyReachable())) return 0;

  const scanned: ScannedFile[] = [];
  for (const [folder, ov] of overrides) {
    if (!ov.enabled) continue;
    const files = await listModels(folder);
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

  for (const s of scanned) {
    await modelRepository.upsertScanned({
      fileName: s.fileName,
      folder: s.folder,
      name: s.name,
      type: s.type,
      baseModel: s.baseModel,
    });
  }

  return scanned.length;
}

/**
 * Query locally-synced model file names for the given COMBO field types, for
 * the canvas dropdown union (P4).
 *
 * `folders` are directory names (which ARE the model types). We
 * match enabled `UserModelConfig` rows whose `folder` is in the requested set,
 * then fetch distinct `fileName`s from `Model` where `isAvailable=true` and
 * `folder` is one of those directories.
 *
 * IMPORTANT: the value is returned **verbatim** (extension included).
 * ComfyUI's COMBO candidates are the exact `/api/models/<folder>` entries —
 * e.g. `waiIllustriousSDXL_v170.safetensors`.
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
