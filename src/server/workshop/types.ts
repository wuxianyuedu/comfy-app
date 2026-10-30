// ── Workshop MCP 服务端本地类型 ─────────────────────────────────
// 与界面共享同一套数据模型（来自 ~/lib/workshop/types），此处仅补充
// 服务端会话状态聚合类型。所有模块均不依赖 `server-only` / `~/env`，
// 以便同一份实现可在 stdio（独立 Node 进程）与 Next HTTP 路由中复用。
import type { Character, PipelineStageId, ProjectMeta, Scene, Shot } from "~/lib/workshop/types";

/** 一个工坊会话的完整流水线状态（内存视图，落库时拆列存储）。
 *  绑定过界面项目（projectId 非空，#2482）后，meta / scenes / characters / shots
 *  的权威读在 production——本视图是「会话行 + production」的合并读数。 */
export interface WorkshopSessionState {
  idea: string;
  meta: ProjectMeta;
  scenes: Array<Scene>;
  characters: Array<Character>;
  shots: Array<Shot>;
  stage: PipelineStageId;
  /** 绑定的界面项目（proj_* = production.id）；桥之前的遗留会话为 null。 */
  projectId: string | null;
}

/** 列表返回用的轻量摘要（不携带 scenes/characters/shots 大字段）。 */
export interface WorkshopSessionSummary {
  id: string;
  userId: string | null;
  /** 绑定的界面项目（proj_* = production.id）；遗留会话为 null。 */
  projectId: string | null;
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
