// ── 会话 ⇄ 界面真值桥（#2482 · FR-AG-01③）────────────────────
// 会话绑定 proj_*（即 production.id），内容权威读在 production；`workshopSession` 内容列只是写时镜像，
// idea / stage / projectId 才是会话行的权威字段。本模块与 `./db` 一样直连 libsql、复用同一份 Drizzle schema
// （表是同一批），因 `~/lib/core` 带 `import "server-only"`，在 MCP stdio / 纯 Node 进程里会抛错。归属：
// userId 可空（外部 AI 通常不带），显式给时必须存在，缺省落本机最早创建的用户；遗留会话（projectId 为 NULL）首次写时桥接，只读保持原读法。
import { asc, eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

import type { Character, Scene, Shot } from "~/lib/workshop/types";
import { production, project, user, type Production } from "~/server/db/schema";
import { workshopDb } from "./db";

/** 会话里「属于界面真值」的内容面：绑定后由 production 承载。 */
export type SessionContent = {
  characters: Array<Character>;
  logline: string;
  scenes: Array<Scene>;
  scriptMarkdown: string;
  shots: Array<Shot>;
  title: string;
  tone: string;
  type: string;
};

/** 解析会话内容的归属用户：显式 id 必须存在；缺省取本机最早的账号（确定性）。 */
export async function resolveOwnerUserId(explicit: string | null): Promise<string> {
  if (explicit !== null && explicit !== "") {
    const found = await workshopDb
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, explicit))
      .limit(1);
    if (!found[0]) {
      throw new Error(`userId 不存在：${explicit}（归属用户必须在应用内已存在）`);
    }
    return explicit;
  }
  const first = await workshopDb
    .select({ id: user.id })
    .from(user)
    .orderBy(asc(user.createdAt))
    .limit(1);
  const owner = first[0]?.id;
  if (owner === undefined) {
    throw new Error(
      "本机还没有任何用户：先在应用内完成一次登录 / 初始化，MCP 会话才有归属（production 行需要 userId）",
    );
  }
  return owner;
}

/** 建 / 绑定项目：给 projectId 就校验存在与归属（缺失的 production 行补建）；
 *  不给就新建 proj_* 的 project + production 两行。返回最终 projectId。 */
export async function ensureProductionProject(
  projectId: string | null,
  ownerId: string,
  title: string,
): Promise<string> {
  if (projectId !== null && projectId !== "") {
    const rows = await workshopDb.select().from(project).where(eq(project.id, projectId)).limit(1);
    const proj = rows[0];
    if (!proj) {
      throw new Error(`项目不存在：${projectId}（projectId 须来自界面的项目列表，不能凭空写）`);
    }
    if (proj.userId !== ownerId) {
      throw new Error(
        `项目 ${projectId} 归属用户 ${proj.userId}，与会话归属 ${ownerId} 冲突，拒绝绑定`,
      );
    }
    await ensureProductionRow(projectId, ownerId, title);
    return projectId;
  }
  const id = `proj_${createId()}`;
  await workshopDb.insert(project).values({ id, userId: ownerId, name: title });
  await workshopDb.insert(production).values({ id, userId: ownerId, title });
  return id;
}

/** production 行缺失时补一行（绑定 UI 侧「只建过画布、没进过工坊」的项目）。 */
async function ensureProductionRow(
  projectId: string,
  ownerId: string,
  title: string,
): Promise<void> {
  const rows = await workshopDb
    .select({ id: production.id })
    .from(production)
    .where(eq(production.id, projectId))
    .limit(1);
  if (rows[0]) {
    return;
  }
  await workshopDb.insert(production).values({ id: projectId, userId: ownerId, title });
}

/** 把会话内容写进 production。**只写内容列**——进度 / run / 评审是另外的字段
 *  所有者（画布 / run 引擎 / 评审器），桥不碰；行缺失时整行新建（带归属）。 */
export async function writeContentToProduction(
  projectId: string,
  fallbackOwnerId: string,
  content: SessionContent,
): Promise<void> {
  const values = {
    id: projectId,
    userId: fallbackOwnerId,
    title: content.title,
    type: content.type,
    tone: content.tone,
    logline: content.logline,
    scriptMarkdown: content.scriptMarkdown,
    scenes: content.scenes,
    characters: content.characters,
    shots: content.shots,
  };
  await workshopDb
    .insert(production)
    .values(values)
    .onConflictDoUpdate({
      target: production.id,
      set: {
        title: values.title,
        type: values.type,
        tone: values.tone,
        logline: values.logline,
        scriptMarkdown: values.scriptMarkdown,
        scenes: values.scenes,
        characters: values.characters,
        shots: values.shots,
      },
    });
}

/** 读会话绑定项目的内容面；行不存在（被外部删掉）返回 null，调用方回落会话行。 */
export async function readProductionContent(projectId: string): Promise<SessionContent | null> {
  const rows = await workshopDb
    .select()
    .from(production)
    .where(eq(production.id, projectId))
    .limit(1);
  const row: Production | undefined = rows[0];
  if (!row) {
    return null;
  }
  return {
    title: row.title,
    type: row.type,
    tone: row.tone,
    logline: row.logline,
    scriptMarkdown: row.scriptMarkdown,
    /* SAFETY: 类型断言已复核 */
    scenes: Array.isArray(row.scenes) ? (row.scenes as Array<Scene>) : [],
    /* SAFETY: 类型断言已复核 */
    characters: Array.isArray(row.characters) ? (row.characters as Array<Character>) : [],
    /* SAFETY: 类型断言已复核 */
    shots: Array.isArray(row.shots) ? (row.shots as Array<Shot>) : [],
  };
}
