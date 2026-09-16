// ── Workshop MCP 会话持久化（repository）───────────────────────
// 纯函数 rowToState / stateToRow 不触碰 DB，便于单测；CRUD 走 workshopDb。
import { desc, eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import type {
  Character,
  PipelineStageId,
  ProjectMeta,
  Scene,
  Shot,
} from "~/lib/workshop/types";
import {
  workshopSession,
  type WorkshopSession,
  type WorkshopSessionInsert,
} from "~/server/db/schema";
import { workshopDb } from "./db";
import type { WorkshopSessionState, WorkshopSessionSummary } from "./types";

const VALID_STAGES: readonly PipelineStageId[] = [
  "script",
  "character",
  "storyboard",
  "shot_generation",
  "video_generation",
  "final_edit",
];

export function isStage(v: unknown): v is PipelineStageId {
  return (
    typeof v === "string" && (VALID_STAGES as readonly string[]).includes(v)
  );
}

/** 纯函数：内存状态 → 可写行（不含 id / 时间戳），便于单测。 */
export function stateToRow(
  state: WorkshopSessionState,
): Partial<WorkshopSessionInsert> {
  return {
    idea: state.idea,
    title: state.meta.title,
    type: state.meta.type,
    tone: state.meta.tone,
    logline: state.meta.logline,
    scriptMarkdown: state.meta.scriptMarkdown ?? "",
    scenes: state.scenes,
    characters: state.characters,
    shots: state.shots,
    stage: isStage(state.stage) ? state.stage : "script",
  };
}

/** 纯函数：行 → 内存状态，便于单测。 */
export function rowToState(row: WorkshopSession): WorkshopSessionState {
  return {
    idea: row.idea,
    meta: {
      title: row.title,
      type: (row.type as ProjectMeta["type"]) ?? "short_video",
      tone: row.tone,
      logline: row.logline,
      scriptMarkdown: row.scriptMarkdown,
    },
    scenes: Array.isArray(row.scenes) ? (row.scenes as Scene[]) : [],
    characters: Array.isArray(row.characters)
      ? (row.characters as Character[])
      : [],
    shots: Array.isArray(row.shots) ? (row.shots as Shot[]) : [],
    stage: isStage(row.stage) ? row.stage : "script",
  };
}

function summarize(row: WorkshopSession): WorkshopSessionSummary {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    type: row.type,
    tone: row.tone,
    logline: row.logline,
    stage: isStage(row.stage) ? row.stage : "script",
    ideaLength: (row.idea ?? "").length,
    scriptLength: (row.scriptMarkdown ?? "").length,
    sceneCount: Array.isArray(row.scenes) ? row.scenes.length : 0,
    characterCount: Array.isArray(row.characters) ? row.characters.length : 0,
    shotCount: Array.isArray(row.shots) ? row.shots.length : 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface CreateSessionInput {
  title?: string;
  type?: string;
  tone?: string;
  logline?: string;
  idea?: string;
  userId?: string | null;
}

export async function createSession(
  input: CreateSessionInput = {},
): Promise<string> {
  const id = createId();
  const insert: WorkshopSessionInsert = {
    id,
    userId: input.userId ?? null,
    title: input.title ?? "未命名工坊项目",
    type: input.type ?? "short_video",
    tone: input.tone ?? "",
    logline: input.logline ?? "",
    idea: input.idea ?? "",
  };
  await workshopDb.insert(workshopSession).values(insert);
  return id;
}

export async function getSession(
  id: string,
): Promise<WorkshopSessionState | null> {
  const rows = await workshopDb
    .select()
    .from(workshopSession)
    .where(eq(workshopSession.id, id))
    .limit(1);
  return rows[0] ? rowToState(rows[0]) : null;
}

export async function listSessions(): Promise<WorkshopSessionSummary[]> {
  const rows = await workshopDb
    .select()
    .from(workshopSession)
    .orderBy(desc(workshopSession.updatedAt));
  return rows.map(summarize);
}

export async function updateState(
  id: string,
  state: WorkshopSessionState,
): Promise<void> {
  await workshopDb
    .update(workshopSession)
    .set(stateToRow(state))
    .where(eq(workshopSession.id, id));
}

export async function deleteSession(id: string): Promise<boolean> {
  const result = await workshopDb
    .delete(workshopSession)
    .where(eq(workshopSession.id, id));
  return (result.changes ?? 0) > 0;
}
