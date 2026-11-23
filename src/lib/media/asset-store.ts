/**
 * `asset-store.ts` — 资产库的文件落盘（ISSUE #4868）。
 * @module media/asset-store — 资产文件从任务产物复制进资产目录的唯一出口
 */
import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

import {
  artifactDiskPath,
  artifactUrl,
  assetsRoot,
  isWithinGeneratedRoot,
} from "~/lib/media/output-paths";
import { logger } from "~/lib/core/logger";

/** 资产文件在磁盘上的目录：`generated/assets/<assetId>/`。 */
function assetStoreDir(assetId: string, root: string = assetsRoot()): string {
  return path.join(root, assetId);
}

/**
 * 把来源产物复制进资产目录，返回资产自己的产物地址（`/api/generated/assets/…`）。
 *
 * 为什么复制而不是引用原路径：任务删除会连同产物目录一起清掉（`task.delete`），
 * 资产若直接指向任务文件，删一次任务就毁一批资产——与「沉淀下来随时可复用」
 * 的诉求相反。复制是单向快照：入库后与原任务互不影响。
 *
 * 来源与目标是**两个根**：来源是任务产物地址（`/api/generated/<taskId>/…` 或
 * `/api/generated/projects/<pid>/<taskId>/…`），必须按**产物根**（`generatedRoot()`）
 * 解析；`root` 形参（默认 `assetsRoot()`，`generated/assets/`）只是复制目标的子层。
 * 此前两个根混用一个形参，来源被解到 `generated/assets/<taskId>/…` 这个不存在的
 * 位置，每张都「来源文件不存在」，入库全批失败（ISSUE #4917）。
 *
 * 返回 `null` 的三种情况由调用点处置（统一按「入库失败」回滚）：来源地址解析
 * 不出来（不是产物地址）、解析结果越出产物根、磁盘上没有这个文件。
 */
export async function copyIntoAssetStore(
  sourceUrl: string,
  assetId: string,
  root: string = assetsRoot(),
): Promise<string | null> {
  const source = artifactDiskPath(sourceUrl);
  if (source === null) {
    logger.warn(`[asset-store] 来源不是产物地址，拒绝入库：${sourceUrl}`);
    return null;
  }
  if (!isWithinGeneratedRoot(source)) {
    logger.warn(`[asset-store] 来源越出产物根，拒绝入库：${sourceUrl}`);
    return null;
  }
  try {
    await fs.access(source);
  } catch {
    logger.warn(`[asset-store] 来源文件不存在：${source}`);
    return null;
  }
  const dir = assetStoreDir(assetId, root);
  await fs.mkdir(dir, { recursive: true });
  const dest = path.join(dir, path.basename(source));
  await fs.copyFile(source, dest);
  return artifactUrl(["assets", assetId, path.basename(dest)]);
}

/** 删除资产的文件目录（删除资产时调用；目录不存在按已清理处理）。 */
export async function removeAssetStoreDir(
  assetId: string,
  root: string = assetsRoot(),
): Promise<void> {
  await fs.rm(assetStoreDir(assetId, root), { recursive: true, force: true });
}
