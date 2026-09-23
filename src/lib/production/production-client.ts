// 统一生产模型的前端读写客户端（Phase 3b-2 写 / 3c-1 读）。
// 工坊自动保存时把「一份生产数据」写穿到 production 表；画布读取并物化为节点。
// 放 src/lib/<domain>-client 层，视图/组件不经手 fetch（对齐 UI/逻辑分离守卫）。
//
// 与 draft-sync-client 同款：静默失败，localStorage 仍是即时缓存，下次再补推。
import { withQuery } from "~/lib/query-string";
import { isRecord } from "~/lib/is-record";
import {
  normalizeProductionProgress,
  type ProductionProgress,
} from "~/lib/production/progress";

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
  /** 完成状态单一来源（Phase 4 / 设计 §7）：阶段游标 + rendered。 */
  progress: ProductionProgress;
}

/** 读回的生产数据（与写入载荷同形）。 */
export type ProductionData = ProductionPayload;

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

/** 拉取某项目的生产数据；无该行 / 请求失败 → null。 */
export async function fetchProduction(
  projectId: string,
): Promise<ProductionData | null> {
  if (!projectId) return null;
  try {
    const res = await fetch(
      withQuery("/api/production", { project: projectId }),
    );
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (isRecord(data) && data.exists === true && isRecord(data.production)) {
      return data.production as unknown as ProductionData;
    }
    return null;
  } catch {
    return null;
  }
}

/** 读某项目的完成状态（阶段游标 + rendered）。工坊与画布共读这一份（Phase 4 / §7）。
 *  无该行 / 请求失败 → null；服务端 progress 是任意 JSON，经 normalize 宽容成合法形状。 */
export async function fetchProductionProgress(
  projectId: string,
): Promise<ProductionProgress | null> {
  const prod = await fetchProduction(projectId);
  if (!prod) return null;
  return normalizeProductionProgress(prod.progress);
}
