// 统一生产模型的前端读写客户端（Phase 3b-2 写 / 3c-1 读）。
// 工坊自动保存时把「一份生产数据」写穿到 production 表；画布读取并物化为节点。
// 放 src/lib/<domain>-client 层，视图/组件不经手 fetch（对齐 UI/逻辑分离守卫）。
//
// 与 draft-sync-client 同款：静默失败，localStorage 仍是即时缓存，下次再补推。
import { withQuery } from "~/lib/query-string";
import { isRecord } from "~/lib/is-record";
import { normalizeProductionProgress, type ProductionProgress } from "~/lib/production/progress";
import { fetchWithTimeout } from "~/lib/network/fetch-with-timeout";

/** 一次生产数据写入的载荷（字段与 production 表列一一对应）。 */
export type ProductionPayload = {
  characters: Array<unknown>;
  logline: string;
  /** 完成状态单一来源（Phase 4 / 设计 §7）：阶段游标 + rendered。 */
  progress: ProductionProgress;
  scenes: Array<unknown>;
  scriptMarkdown: string;
  shots: Array<unknown>;
  title: string;
  tone: string;
  type: string;
};

/** 一次写入里**实际要落的字段**（ISSUE #5147）：全量载荷的子集。
 *
 *  自动保存写的是「用户改了什么」而不是整份草稿 —— 详见
 *  `~/lib/production/payload` 的 `narrowProductionWrite`。缺键 = 这一列不动。 */
export type ProductionWrite = Partial<ProductionPayload>;

/**
 * `PUT /api/production` 的结论（ISSUE #5147）。
 *
 * - `written`：服务端已按这份载荷落库（可能只是其中一部分字段）；
 * - `stale`：服务端版本比载荷带来的 `baseUpdatedAt` 更新 ⇒ 这次写入被拒，
 *   库里的内容没有被覆盖（调用方据此提示「服务端内容已更新」）；
 * - `failed`：网络 / 服务不可用，什么都没落（下次自动保存再补推）。
 *
 * 此前这个函数回 `void`、把三种结局压成同一种静默 —— 而 #5147 的现场正是
 * 「覆盖发生了，界面却以为保存成功」。冲突必须能被调用方看见。
 */
export type ProductionPushResult = "written" | "stale" | "failed";

/** 读回的生产数据（与写入载荷同形，外加服务端版本戳）。 */
export type ProductionData = ProductionPayload & {
  /** 服务端这一行的版本时刻（epoch ms，ISSUE #5147）：自动保存的窄写入把它
   *  当作 `baseUpdatedAt` 带回去，服务端据此拒绝迟到写。
   *  缺省（旧行 / 读不到）= 不参与版本闸，行为与此前一致。 */
  updatedAt?: number;
};

/** 服务端时间戳 → epoch ms：drizzle 行经 JSON 序列化后是 ISO 串，也接受数字。 */
function toEpochMs(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string" && raw !== "") {
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

/**
 * 服务端 production 行的宽松读法：必填字段缺省 / 类型不符按默认兜底，其余键原样保留
 * （画布还会读 `scriptReview` / `run` 等不在载荷类型里的列）。不抛。
 */
function normalizeProductionData(raw: Record<string, unknown>): ProductionData {
  return {
    ...raw,
    characters: Array.isArray(raw.characters) ? raw.characters : [],
    logline: typeof raw.logline === "string" ? raw.logline : "",
    progress: normalizeProductionProgress(raw.progress),
    scenes: Array.isArray(raw.scenes) ? raw.scenes : [],
    scriptMarkdown: typeof raw.scriptMarkdown === "string" ? raw.scriptMarkdown : "",
    shots: Array.isArray(raw.shots) ? raw.shots : [],
    title: typeof raw.title === "string" ? raw.title : "",
    tone: typeof raw.tone === "string" ? raw.tone : "",
    type: typeof raw.type === "string" ? raw.type : "",
    updatedAt: toEpochMs(raw.updatedAt),
  };
}

/**
 * 把某项目的生产数据写穿到服务端 production 表（按 proj_* upsert）。
 *
 * `payload` 刻意收成 `ProductionWrite`（全量载荷也满足它）：自动保存要能只发
 * 「用户改过的字段」（ISSUE #5147），而不是把整份旧草稿整片盖上去。
 * **没带的键 = 那一列不动**（服务端按同一口径窄写）。
 *
 * `baseUpdatedAt` 是「我这份内容基于服务端哪个版本」的凭据（epoch ms，取自
 * 上一次读到的 `updatedAt`）：只对**整份快照**生效 —— 服务端发现库里比它更新时
 * 跳过这次整片写入并回 `stale`，界面据此提示「服务端内容已更新，是否采用」，
 * 而不是静默互相覆盖。
 */
export async function pushProduction(
  projectId: string,
  payload: ProductionWrite,
  baseUpdatedAt?: number,
): Promise<ProductionPushResult> {
  if (!projectId) {
    return "failed";
  }
  try {
    const res = await fetchWithTimeout("/api/production", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project: projectId,
        production: payload,
        ...(baseUpdatedAt === undefined ? {} : { baseUpdatedAt }),
      }),
    });
    if (!res.ok) {
      return "failed";
    }
    /* `stale` 是服务端的一句读数（「你基于的那版旧了，库没被我覆盖」），
     * 不是失败：HTTP 仍是 200（与草稿镜像 ifNewer 同形状，#4023）。 */
    const body: unknown = await res.json();
    return isRecord(body) && body.stale === true ? "stale" : "written";
  } catch {
    /* 网络/服务不可用时静默降级：localStorage 仍是即时缓存 */
    return "failed";
  }
}

/** 拉取某项目的生产数据；无该行 / 请求失败 → null。 */
export async function fetchProduction(projectId: string): Promise<ProductionData | null> {
  if (!projectId) {
    return null;
  }
  try {
    const res = await fetchWithTimeout(withQuery("/api/production", { project: projectId }));
    if (!res.ok) {
      return null;
    }
    const data: unknown = await res.json();
    if (isRecord(data) && data.exists === true && isRecord(data.production)) {
      return normalizeProductionData(data.production);
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
  if (!prod) {
    return null;
  }
  return normalizeProductionProgress(prod.progress);
}
