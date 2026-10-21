/* ── 任务产物的图片列表客户端（第②层的网络部分）───────────────────────
 * 项目画布的图片资产节点需要「这张任务到底出了几张图」来决定要不要开相册。
 * 此前这段 `vanillaApi.task.detail.query` + 手搓收窄直接写在
 * ContentAssetNode.tsx（视图）里，且是该文件唯一的 IO 点。
 *
 * 收窄规则集中在这里：
 *   - `localPath` 必须是字符串；
 *   - `id` / `isCover` 缺失时按空串 / false 兜底，而不是整条丢弃——
 *     缺 id 的图仍要能在相册里翻页展示。
 *
 * 那两份判据拿的是**关系装载行**（`db.query.task.findFirst({ with: { images } })`，
 * `task` 表本身没有 images 列），不是「一段自由格式 JSON」—— 要防的是列被改名 / 少发
 * 这一族漂移，所以这里保留逐字段窄化，而不是整包 `JSON.parse` 后当合法数据用。
 *
 * 这份形状原先是一个手写 `type` 加一处 `as unknown as`：类型擦除之后**运行时没有
 * 任何东西知道客户端读了哪几列**，于是 `tests/task-detail-images-wire-contract.test.ts`
 * 那类「镜像声明的列 ↔ 服务端真实发出的列」契约判据（台账 E4）对它无从下手 ——
 * 列被改名时表现不是报错，是相册永远空。换成 zod 镜像正是为了让这一格可判。
 */

import { z } from "zod";
import { vanillaApi } from "~/trpc/vanilla";

export interface TaskGalleryImage {
  id: string;
  localPath: string;
  isCover: boolean;
}

/**
 * 服务端 `taskImage` 关系行里**本客户端真正依赖的那几列**。
 *
 * `.nullish()` 不是随手写的宽容：今天的口径是「缺 `id` / 缺 `isCover` 的图仍要展示」，
 * 而 `null` 与 `undefined` 在 JSON 传输后是两种形状（`undefined` 键直接消失）。
 * 只把 `localPath` 判成必需 —— 没有它这张图连路径都没有，留着只会渲染出一个空格子。
 */
export const taskImageRowSchema = z.object({
  id: z.string().nullish(),
  localPath: z.string(),
  isCover: z.boolean().nullish(),
});

/**
 * 把线上来的图片行窄化成视图要的形状（不合法的行丢弃，缺省按兜底值补）。
 *
 * 单独导出是为了让**契约判据**能拿同一份实现做漂移验证
 * （`tests/task-detail-images-wire-contract.test.ts` 要在「服务端把列改名」这一份数据上
 * 直接判空相册），与 `~/lib/media/video-queue-client` 的 `parseVideoRows` 同形。
 * 顺序不在这里重排：封面在前由服务端的 `orderBy(isCover desc, sortIndex asc)` 给。
 */
export function parseTaskImageRows(
  rows: readonly unknown[],
): TaskGalleryImage[] {
  return rows
    .map((row) => taskImageRowSchema.safeParse(row))
    .filter((parsed) => parsed.success)
    .map((parsed) => ({
      id: parsed.data.id ?? "",
      localPath: parsed.data.localPath,
      isCover: parsed.data.isCover ?? false,
    }));
}

/** 拉取任务的产出图片列表。失败由调用方决定（相册场景是静默降级）。 */
export async function fetchTaskImages(
  taskId: string,
): Promise<TaskGalleryImage[]> {
  const task = await vanillaApi.task.detail.query({ id: taskId });
  return parseTaskImageRows(task.images ?? []);
}
