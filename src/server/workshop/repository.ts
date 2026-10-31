// ── Workshop MCP 会话持久化（repository）───────────────────────
// 纯函数 rowToState / stateToRow 不触碰 DB，便于单测；CRUD 走 workshopDb。
import { desc, eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import type { Character, PipelineStageId, ProjectMeta, Scene, Shot } from "~/lib/workshop/types";
import {
  workshopSession,
  type WorkshopSession,
  type WorkshopSessionInsert,
} from "~/server/db/schema";
import { workshopDb } from "./db";
import {
  ensureProductionProject,
  readProductionContent,
  resolveOwnerUserId,
  writeContentToProduction,
  type SessionContent,
} from "./production-bridge";
import type { WorkshopSessionState, WorkshopSessionSummary } from "./types";

const VALID_STAGES: ReadonlyArray<PipelineStageId> = [
  "script",
  "character",
  "storyboard",
  "shot_generation",
  "video_generation",
  "final_edit",
];

export function isStage(v: unknown): v is PipelineStageId {
  return (
    typeof v === "string" &&
    /* SAFETY: 类型断言已复核 */ (VALID_STAGES as ReadonlyArray<string>).includes(v)
  );
}

/** 纯函数：内存状态 → 可写行（不含 id / 时间戳），便于单测。 */
export function stateToRow(state: WorkshopSessionState): Partial<WorkshopSessionInsert> {
  return {
    characters: state.characters,
    idea: state.idea,
    logline: state.meta.logline,
    scenes: state.scenes,
    scriptMarkdown: state.meta.scriptMarkdown ?? "",
    shots: state.shots,
    stage: isStage(state.stage) ? state.stage : "script",
    title: state.meta.title,
    tone: state.meta.tone,
    type: state.meta.type,
  };
}

/** 纯函数：状态 → production 内容面（桥写的字段集；idea / stage 不在其中）。 */
function contentOf(state: WorkshopSessionState): SessionContent {
  return {
    characters: state.characters,
    logline: state.meta.logline,
    scenes: state.scenes,
    scriptMarkdown: state.meta.scriptMarkdown ?? "",
    shots: state.shots,
    title: state.meta.title,
    tone: state.meta.tone,
    type: state.meta.type,
  };
}

/** 纯函数：production 内容面覆写状态（绑定会话的权威读；行缺失时调用方不覆写）。 */
function applyContentToState(
  state: WorkshopSessionState,
  content: SessionContent,
): WorkshopSessionState {
  return {
    ...state,
    characters: content.characters,
    meta: {
      ...state.meta,
      logline: content.logline,
      scriptMarkdown: content.scriptMarkdown,
      title: content.title,
      tone: content.tone,
      type: /* SAFETY: 类型断言已复核 */ (content.type as ProjectMeta["type"]) ?? state.meta.type,
    },
    scenes: content.scenes,
    shots: content.shots,
  };
}

/** 纯函数：行 → 内存状态，便于单测。 */
export function rowToState(row: WorkshopSession): WorkshopSessionState {
  return {
    idea: row.idea,
    meta: {
      logline: row.logline,
      scriptMarkdown: row.scriptMarkdown,
      title: row.title,
      tone: row.tone,
      type: /* SAFETY: 类型断言已复核 */ (row.type as ProjectMeta["type"]) ?? "short_video",
    },
    /* SAFETY: 类型断言已复核 */
    scenes: Array.isArray(row.scenes) ? (row.scenes as Array<Scene>) : [],
    /* SAFETY: 类型断言已复核 */
    characters: Array.isArray(row.characters) ? (row.characters as Array<Character>) : [],
    /* SAFETY: 类型断言已复核 */
    projectId: row.projectId ?? null,
    shots: Array.isArray(row.shots) ? (row.shots as Array<Shot>) : [],
    stage: isStage(row.stage) ? row.stage : "script",
  };
}

function summarize(row: WorkshopSession): WorkshopSessionSummary {
  return {
    characterCount: Array.isArray(row.characters) ? row.characters.length : 0,
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    ideaLength: (row.idea ?? "").length,
    logline: row.logline,
    projectId: row.projectId ?? null,
    sceneCount: Array.isArray(row.scenes) ? row.scenes.length : 0,
    scriptLength: (row.scriptMarkdown ?? "").length,
    shotCount: Array.isArray(row.shots) ? row.shots.length : 0,
    stage: isStage(row.stage) ? row.stage : "script",
    title: row.title,
    tone: row.tone,
    type: row.type,
    updatedAt: row.updatedAt.toISOString(),
    userId: row.userId,
  };
}

export type CreateSessionInput = {
  idea?: string;
  logline?: string;
  /** 可选：绑定界面侧**既有**项目（proj_* = production.id）。缺省新建一对
   *  project + production 行；给了就必须存在且归属一致（桥的口径，#2482）。 */
  projectId?: string | null;
  title?: string;
  tone?: string;
  type?: string;
  userId?: string | null;
};

export async function createSession(input: CreateSessionInput = {}): Promise<string> {
  const id = createId();
  // 桥（#2482）：每个新会话创建即绑定一份界面真值（project + production），
  // 外部 AI 写的内容从第一刻起就在界面上可见（FR-AG-01③）。
  const ownerId = await resolveOwnerUserId(input.userId ?? null);
  const projectId = await ensureProductionProject(
    input.projectId ?? null,
    ownerId,
    input.title ?? "未命名工坊项目",
  );
  const insert: WorkshopSessionInsert = {
    id,
    idea: input.idea ?? "",
    logline: input.logline ?? "",
    projectId,
    title: input.title ?? "未命名工坊项目",
    tone: input.tone ?? "",
    type: input.type ?? "short_video",
    userId: input.userId ?? null,
  };
  await workshopDb.insert(workshopSession).values(insert);
  return id;
}

export async function getSession(id: string): Promise<WorkshopSessionState | null> {
  const rows = await workshopDb
    .select()
    .from(workshopSession)
    .where(eq(workshopSession.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  const state = rowToState(row);
  // 桥（#2482）：绑定过的会话，内容权威读在 production——人在界面改了，
  // AI 下一次 get 读到的就是新的（FR-AG-01①「人改 AI 见」）。
  if (row.projectId) {
    const content = await readProductionContent(row.projectId);
    if (content) {
      return applyContentToState(state, content);
    }
  }
  return state;
}

export async function listSessions(): Promise<Array<WorkshopSessionSummary>> {
  const rows = await workshopDb
    .select()
    .from(workshopSession)
    .orderBy(desc(workshopSession.updatedAt));
  return rows.map(summarize);
}

export async function updateState(id: string, state: WorkshopSessionState): Promise<void> {
  const rows = await workshopDb
    .select()
    .from(workshopSession)
    .where(eq(workshopSession.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return;
  } // 既有语义：无行不写（编排器先 load，正常到不了这里）。
  let projectId = row.projectId;
  if (!projectId) {
    // 遗留会话（桥之前建的）首次写 → 桥接：以当前内容为初始值新建项目，
    // 此后与界面同一份真值；只读不写的遗留会话保持原样、不凭空长出项目。
    const ownerId = await resolveOwnerUserId(row.userId);
    projectId = await ensureProductionProject(null, ownerId, state.meta.title);
  }
  await writeContentToProduction(
    projectId,
    row.userId ?? (await resolveOwnerUserId(row.userId)),
    contentOf(state),
  );
  // 会话行：idea / stage / projectId 是自己的权威字段；内容列写镜像，
  // 防「直接读表的人看到陈旧内容」的第二真值困惑（权威读始终在 production）。
  await workshopDb
    .update(workshopSession)
    .set({ ...stateToRow(state), projectId })
    .where(eq(workshopSession.id, id));
}

export async function deleteSession(id: string): Promise<boolean> {
  const result = await workshopDb.delete(workshopSession).where(eq(workshopSession.id, id));
  // libsql 的 ResultSet 用 rowsAffected（better-sqlite3 的 RunResult.changes 已不存在）。
  return (result.rowsAffected ?? 0) > 0;
}
