// 统一生产模型的前端写入客户端（Phase 3b-2）。
// 工坊在自动保存时，除了既有的 workshopDraft 镜像，额外把「一份生产数据」
// 写穿到 production 表，供画布读取物化（3c）。放 src/lib/<domain>-client 层，
// 视图/组件不经手 fetch（对齐 UI/逻辑分离守卫）。
//
// 与 draft-sync-client 同款：静默失败，localStorage 仍是即时缓存，下次再补推。
// 读侧（fetchProduction）在 Phase 3c 画布接入时再补，避免此刻留下无消费方的导出。

/** 一次生产数据写入的载荷（字段与 production 表列一一对应）。 */
export interface ProductionPayload {
  title: string;
  type: string;
  tone: string;
  logline: string;
  scriptMarkdown: string;
  scenes: unknown[];
  characters: unknown[];
  shots: unknown[];
  progress: { stage: string; rendered: boolean };
}

/** 把某项目的生产数据写穿到服务端 production 表（按 proj_* upsert）。静默失败。 */
export async function pushProduction(
  projectId: string,
  payload: ProductionPayload,
): Promise<void> {
  if (!projectId) return;
  try {
    await fetch("/api/production", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: projectId, production: payload }),
    });
  } catch {
    /* 网络/服务不可用时静默降级：localStorage 仍是即时缓存 */
  }
}
