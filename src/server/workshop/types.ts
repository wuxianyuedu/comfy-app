// ── Workshop MCP 服务端本地类型 ─────────────────────────────────
// 与界面共享同一套数据模型（来自 ~/lib/workshop/types），此处仅补充
// 服务端会话状态聚合类型。所有模块均不依赖 `server-only` / `~/env`，
// 以便同一份实现可在 stdio（独立 Node 进程）与 Next HTTP 路由中复用。
import type {
  Character,
  PipelineStageId,
  ProjectMeta,
  Scene,
  Shot,
} from "~/lib/workshop/types";

/** 一个工坊会话的完整流水线状态（内存视图，落库时拆列存储）。 */
export interface WorkshopSessionState {
  idea: string;
  meta: ProjectMeta;
  scenes: Scene[];
  characters: Character[];
  shots: Shot[];
  stage: PipelineStageId;
}

/** 列表返回用的轻量摘要（不携带 scenes/characters/shots 大字段）。 */
export interface WorkshopSessionSummary {
  id: string;
  userId: string | null;
  title: string;
  type: string;
  tone: string;
  logline: string;
  stage: PipelineStageId;
  ideaLength: number;
  scriptLength: number;
  sceneCount: number;
  characterCount: number;
  shotCount: number;
  createdAt: string;
  updatedAt: string;
}
