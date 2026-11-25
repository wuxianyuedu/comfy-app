/**
 * `character-store.ts` — 角色库的立绘落盘（ISSUE #5009）。
 * @module character/character-store — 立绘从任务产物复制进角色目录的唯一出口
 */
import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

import {
  artifactDiskPath,
  artifactUrl,
  characterLibraryRoot,
  isWithinGeneratedRoot,
} from "~/lib/media/output-paths";
import { logger } from "~/lib/core/logger";

/** 角色立绘在磁盘上的目录：`generated/character-library/<characterId>/`。 */
function characterStoreDir(characterId: string, root: string = characterLibraryRoot()): string {
  return path.join(root, characterId);
}

/**
 * 把来源任务产物复制进角色目录，返回角色自己的产物地址
 * （`/api/generated/character-library/…`）。
 *
 * 为什么复制而不是引用原路径：任务删除会连同产物目录一起清掉（`task.delete`），
 * 角色若直接指向任务文件，删一次任务就毁一批立绘——与「沉淀下来随时可复用」
 * 的诉求相反（同资产库 `copyIntoAssetStore` 的口径）。
 *
 * 返回 `null` 的三种情况由调用点处置（该角色按「生成失败 / 产物缺失」回写）：
 * 来源地址解析不出来、解析结果越出产物根、磁盘上没有这个文件。
 */
export async function copyIntoCharacterStore(
  sourceUrl: string,
  characterId: string,
  root: string = characterLibraryRoot(),
): Promise<string | null> {
  const source = artifactDiskPath(sourceUrl);
  if (source === null) {
    logger.warn(`[character-store] 来源不是产物地址，拒绝入库：${sourceUrl}`);
    return null;
  }
  if (!isWithinGeneratedRoot(source)) {
    logger.warn(`[character-store] 来源越出产物根，拒绝入库：${source}`);
    return null;
  }
  try {
    await fs.access(source);
  } catch {
    logger.warn(`[character-store] 来源文件不存在：${source}`);
    return null;
  }
  const dir = characterStoreDir(characterId, root);
  await fs.mkdir(dir, { recursive: true });
  const dest = path.join(dir, path.basename(source));
  await fs.copyFile(source, dest);
  return artifactUrl(["character-library", characterId, path.basename(dest)]);
}

/** 删除角色的立绘目录（删除角色时调用；目录不存在按已清理处理）。 */
export async function removeCharacterStoreDir(
  characterId: string,
  root: string = characterLibraryRoot(),
): Promise<void> {
  await fs.rm(characterStoreDir(characterId, root), { recursive: true, force: true });
}

/** 读一份产物地址的字节（质量打分要拿原始 PNG 解析）；失败返回 null。 */
export async function readArtifactBytes(url: string): Promise<Uint8Array | null> {
  const source = artifactDiskPath(url);
  if (source === null || !isWithinGeneratedRoot(source)) {
    return null;
  }
  try {
    return new Uint8Array(await fs.readFile(source));
  } catch {
    return null;
  }
}
