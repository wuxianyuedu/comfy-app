// Workshop 前端项目草稿的服务端同步客户端（纯 fetch 封装）。
// 供 use-workshop-pipeline 在自动保存时写穿到 db.sqlite，并在挂载时拉回恢复。
// 放 src/lib/<domain>-client 层，视图组件不经手 fetch（对齐 UI/逻辑分离守卫）。
import { withQuery } from "~/lib/query-string";
import type { WorkshopDraftDto } from "~/lib/workshop/draft-sync-shared";

export interface ServerDraftSummary {
  id: string;
  title: string;
  updatedAt: string;
}

/** 拉取当前用户全部服务端项目摘要（本地索引清空后用于重建）。 */
export async function fetchServerDraftList(): Promise<ServerDraftSummary[]> {
  const res = await fetch("/api/workshop/draft");
  if (!res.ok) return [];
  const data: unknown = await res.json();
  if (
    typeof data === "object" &&
    data !== null &&
    Array.isArray((data as { drafts?: unknown }).drafts)
  ) {
    return (data as { drafts: ServerDraftSummary[] }).drafts;
  }
  return [];
}

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

/** 删除某项目服务端镜像（前端删项目时一并清理）。静默失败不影响本地。 */
export async function deleteServerDraft(projectId: string): Promise<void> {
  try {
    await fetch(withQuery("/api/workshop/draft", { project: projectId }), {
      method: "DELETE",
    });
  } catch {
    /* 忽略 */
  }
}
