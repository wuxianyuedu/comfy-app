/* ── 任务产物的图片列表客户端（第②层的网络部分）───────────────────────
 * 项目画布的图片资产节点需要「这张任务到底出了几张图」来决定要不要开相册。
 * 此前这段 `vanillaApi.task.detail.query` + 手搓收窄直接写在
 * ContentAssetNode.tsx（视图）里，且是该文件唯一的 IO 点。
 *
 * 收窄规则集中在这里：
 *   - `localPath` 必须是字符串（服务端 Prisma Json 列，形状不可信）；
 *   - `id` / `isCover` 缺失时按空串 / false 兜底，而不是整条丢弃——
 *     缺 id 的图仍要能在相册里翻页展示。
 */

import { vanillaApi } from "~/trpc/vanilla";

export interface TaskGalleryImage {
  id: string;
  localPath: string;
  isCover: boolean;
}

/** 服务端 Prisma Json 列下来的图片条目形状（每个字段都可能是 undefined）。 */
type RawTaskImage = {
  id?: string;
  localPath?: string;
  isCover?: boolean;
};

/** localPath 已确认为 string 的子形状（供 filter 的类型谓词使用）。 */
type TaskImageWithLocalPath = RawTaskImage & { localPath: string };

function hasLocalPath(
  img: RawTaskImage | undefined,
): img is TaskImageWithLocalPath {
  return !!img && typeof img.localPath === "string";
}

/** 拉取任务的产出图片列表。失败由调用方决定（相册场景是静默降级）。 */
export async function fetchTaskImages(
  taskId: string,
): Promise<TaskGalleryImage[]> {
  const task = await vanillaApi.task.detail.query({ id: taskId });
  const rawImages = (task.images ?? []) as unknown as RawTaskImage[];
  return rawImages.filter(hasLocalPath).map((img) => ({
    id: img.id ?? "",
    localPath: img.localPath,
    isCover: img.isCover ?? false,
  }));
}
