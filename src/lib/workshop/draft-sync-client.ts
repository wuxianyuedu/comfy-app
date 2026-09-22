// Workshop 前端项目草稿的服务端同步客户端（纯 fetch 封装）。
// 供 use-workshop-pipeline 在自动保存时写穿到 db.sqlite，并在挂载时拉回恢复。
// 放 src/lib/<domain>-client 层，视图组件不经手 fetch（对齐 UI/逻辑分离守卫）。
//
// Phase 2：工坊并入统一 proj_* 项目后不再有「列全部云端项目重建本地索引」与
// 「删某个工坊项目镜像」的能力（项目增删统一在首页 canvas-store 走），故只保留
// 单项目读 / 写两个函数。
import { withQuery } from "~/lib/query-string";
import type { WorkshopDraftDto } from "~/lib/workshop/draft-sync-shared";

/** 拉取某项目的服务端草稿；服务端无该行或已空 → 返回 null。 */
export async function fetchServerDraft(
  projectId: string,
): Promise<WorkshopDraftDto | null> {
  try {
    const res = await fetch(
      withQuery("/api/workshop/draft", { project: projectId }),
    );
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (
      typeof data === "object" &&
      data !== null &&
      (data as { exists?: unknown }).exists === true
    ) {
      return (data as { draft: WorkshopDraftDto }).draft;
    }
    return null;
  } catch {
    return null;
  }
}

/** 把某项目草稿写穿到服务端（写本地之外的第二份持久化副本）。静默失败不影响编辑。 */
export async function pushServerDraft(
  projectId: string,
  draft: WorkshopDraftDto,
): Promise<void> {
  try {
    await fetch("/api/workshop/draft", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: projectId, draft }),
    });
  } catch {
    /* 网络/服务不可用时静默降级：localStorage 仍是即时缓存，下次再补推 */
  }
}
