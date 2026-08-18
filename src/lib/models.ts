import { prisma } from "./db";
import { listModels, comfyBase } from "./comfyui/client";
import { type ModelType } from "./model-types";

export function baseFromName(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("illustrious") || n.includes("sdxl")) return "SDXL";
  if (n.includes("flux")) return "Flux";
  if (n.includes("sd1.5") || n.includes("sd_1.5") || n.includes("sd15")) return "SD1.5";
  if (n.includes("pony")) return "Pony";
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
    const res = await fetch(`${comfyBase()}/system_stats`, { signal: AbortSignal.timeout(1500) });
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
 * R-ardot41 (zero-implicit-default): only folders the user has explicitly
 * enabled in `UserModelConfig` are visited.  R-ardot45: each directory IS its
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
    const rows = await prisma.userModelConfig.findMany({ where: { userId } });
    for (const r of rows) {
      overrides.set(r.folder, { enabled: r.enabled, isCustom: r.isCustom });
    }
  } else {
    // Legacy path (no user): not used by /api/models/sync.
    return 0;
  }

  // STEP 1 — unconditionally retire every LOCAL row.
  await prisma.model.updateMany({ where: { source: "LOCAL" }, data: { isAvailable: false } });

  // STEP 2 — re-fill from disk only if ComfyUI is reachable.
  if (!(await isComfyReachable())) return 0;

  const scanned: ScannedFile[] = [];
  for (const [folder, ov] of overrides) {
    if (!ov.enabled) continue;
    const files = await listModels(folder);
    for (const fileName of files) {
      const name = stripExt(fileName);
      scanned.push({ folder, fileName, type: folder, name, baseModel: baseFromName(name) });
    }
  }

  for (const s of scanned) {
    await prisma.model.upsert({
      where: { fileName_folder: { fileName: s.fileName, folder: s.folder } },
      create: {
        fileName: s.fileName,
        folder: s.folder,
        name: s.name,
        type: s.type,
        baseModel: s.baseModel,
        isAvailable: true,
        source: "LOCAL",
      },
      update: {
        isAvailable: true,
        name: s.name,
        type: s.type,
        baseModel: s.baseModel,
      },
    });
  }

  return scanned.length;
}

/**
 * Query locally-synced model file names for the given COMBO field types, for
 * the canvas dropdown union (P4).
 *
 * R-ardot45: `folders` are directory names (which ARE the model types).  We
 * match enabled `UserModelConfig` rows whose `folder` is in the requested set,
 * then fetch distinct `fileName`s from `Model` where `isAvailable=true` and
 * `folder` is one of those directories.
 *
 * IMPORTANT: the value is returned **verbatim** (extension included).
 * ComfyUI's COMBO candidates are the exact `/api/models/<folder>` entries —
 * e.g. `waiIllustriousSDXL_v170.safetensors`.
 */
export async function localModelFileNames(folders: string[]): Promise<string[]> {
  if (!folders.length) return [];
  const rows = await prisma.userModelConfig.findMany({
    where: { enabled: true },
    select: { folder: true },
  });
  const wanted = new Set(folders);
  const matchedFolders = rows.filter((r) => wanted.has(r.folder)).map((r) => r.folder);
  if (!matchedFolders.length) return [];
  const models = await prisma.model.findMany({
    where: { isAvailable: true, folder: { in: matchedFolders } },
    select: { fileName: true },
  });
  const out = new Set<string>();
  for (const m of models) out.add(m.fileName);
  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

/** File counts per folder, for the config modal's "文件数" column. */
export async function modelCountsByFolder(): Promise<Record<string, number>> {
  const rows = await prisma.model.groupBy({
    by: ["folder"],
    where: { isAvailable: true },
    _count: { _all: true },
  });
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (r.folder) out[r.folder] = r._count._all;
  }
  return out;
}