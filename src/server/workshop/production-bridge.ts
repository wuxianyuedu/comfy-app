// ── 会话 ⇄ 界面真值桥（#2482 · FR-AG-01③）────────────────────
// 会话绑定 proj_*（即 production.id），内容权威读在 production；`workshopSession` 内容列只是写时镜像，
// idea / stage / projectId 才是会话行的权威字段。本模块与 `./db` 一样直连 node:sqlite、复用同一份 Drizzle schema
// （表是同一批），因 `~/lib/core` 带 `import "server-only"`，在 MCP stdio / 纯 Node 进程里会抛错。归属：
// userId 可空（外部 AI 通常不带），显式给时必须存在，缺省落本机最早创建的用户；遗留会话（projectId 为 NULL）首次写时桥接，只读保持原读法。
import { asc, eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

import type { Character, Scene, Shot } from "~/lib/workshop/types";
import { production, project, user, type Production } from "~/server/db/schema";
import { workshopDb } from "./db";

/** 事务执行者：`workshopDb` 本体或 `workshopDb.transaction` 回调里的那条连接
 *  （都从签名派生，不手写；与 `~/lib/core/repository-executor-types` 同一形状 ——
 *  本文件服务 MCP 纯 Node 进程，不能引 `~/lib/core` 的运行时模块，故在此按
 *  同口径派生一份）。
 *
 *  必须导出：它在公开签名 `ensureProductionProject.executor` 里被引用，typedoc
 *  只收「从入口可达且带 export」的符号——不导出会让 API 文档自检报
 *  「referenced … but not included」（ISSUE #4407 / 修法先例 #2835）。 */
export type WorkshopExecutor =
  | typeof workshopDb
  | Parameters<Parameters<typeof workshopDb.transaction>[0]>[0];

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

// JSON 列只判「是数组」这一层（元素形状由写入端保证，读侧 draft-integrity 判；
// 认不出就丢等于静默删数据），非数组回落 []。
function isSceneArray(v: unknown): v is Array<Scene> {
  return Array.isArray(v);
}
function isCharacterArray(v: unknown): v is Array<Character> {
  return Array.isArray(v);
}
function isShotArray(v: unknown): v is Array<Shot> {
  return Array.isArray(v);
}

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
 *  不给就新建 proj_* 的 project + production 两行。返回最终 projectId。
 *  `executor`：由事务入口（updateState 的 immediate 事务，ISSUE #3852）传入，
 *  读写都走事务里的连接（§18.10.1 的同一条纪律）。 */
export async function ensureProductionProject(
  projectId: string | null,
  ownerId: string,
  title: string,
  executor?: WorkshopExecutor,
): Promise<string> {
  const exec = executor ?? workshopDb;
  if (projectId !== null && projectId !== "") {
    const rows = await exec.select().from(project).where(eq(project.id, projectId)).limit(1);
    const proj = rows[0];
    if (!proj) {
      throw new Error(`项目不存在：${projectId}（projectId 须来自界面的项目列表，不能凭空写）`);
    }
    if (proj.userId !== ownerId) {
      throw new Error(
        `项目 ${projectId} 归属用户 ${proj.userId}，与会话归属 ${ownerId} 冲突，拒绝绑定`,
      );
    }
    await ensureProductionRow(projectId, ownerId, title, exec);
    return projectId;
  }
  const id = `proj_${createId()}`;
  await exec.insert(project).values({ id, userId: ownerId, name: title });
  await exec.insert(production).values({ id, userId: ownerId, title });
  return id;
}

/** production 行缺失时补一行（绑定 UI 侧「只建过画布、没进过工坊」的项目）。
 *  单语句 `onConflictDoNothing`（ISSUE #3835）：ensure 语义 = 重复执行成功且
 *  无害；先查后插在并发首存（MCP 桥接与工坊保存赛跑）会同抢主键让后到者 500。 */
async function ensureProductionRow(
  projectId: string,
  ownerId: string,
  title: string,
  executor?: WorkshopExecutor,
): Promise<void> {
  const exec = executor ?? workshopDb;
  await exec
    .insert(production)
    .values({ id: projectId, userId: ownerId, title })
    .onConflictDoNothing({ target: production.id });
}

/** 会话内容列 → production 行的列值（不含 id / userId / 时间戳）。 */
function contentColumns(content: SessionContent): {
  characters: SessionContent["characters"];
  logline: string;
  scenes: SessionContent["scenes"];
  scriptMarkdown: string;
  shots: SessionContent["shots"];
  title: string;
  tone: string;
  type: string;
} {
  return {
    title: content.title,
    type: content.type,
    tone: content.tone,
    logline: content.logline,
    scriptMarkdown: content.scriptMarkdown,
    scenes: content.scenes,
    characters: content.characters,
    shots: content.shots,
  };
}

/** shots 按 shotId 叠加合并（ISSUE #4730）：当前 production 为底，会话态逐 id
 *  覆盖 / 追加——慢 IO 期间界面新增的镜头（不在会话态里）得以保留，会话改过的
 *  镜头按锁内后写生效。 */
export function mergeShotsById(current: Array<Shot>, mine: Array<Shot>): Array<Shot> {
  const merged = [...current];
  const indexById = new Map<string, number>();
  merged.forEach((shot, index) => indexById.set(shot.id, index));
  for (const shot of mine) {
    const at = indexById.get(shot.id);
    if (at === undefined) {
      indexById.set(shot.id, merged.length);
      merged.push(shot);
    } else {
      merged[at] = shot;
    }
  }
  return merged;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** 逐列与基线比对（ISSUE #4730）：只把会话真正改过的列放进补丁——慢 IO 期间
 *  界面改动的其它列（剧本 / 角色卡 / 镜头提示词…）不再被旧快照整列覆盖。
 *  shots 改过时按 shotId 与当前 production 叠加合并，而非整列替换。
 *  `current` 是写前 production 的内容面（行缺失传 null）。返回空补丁 = 相对
 *  基线无变化（调用方跳过 UPDATE）。 */
export function diffContentAgainstBaseline(
  baseline: SessionContent,
  next: SessionContent,
  current: SessionContent | null,
): Partial<SessionContent> {
  const patch: Partial<SessionContent> = {};
  if (next.title !== baseline.title) {
    patch.title = next.title;
  }
  if (next.type !== baseline.type) {
    patch.type = next.type;
  }
  if (next.tone !== baseline.tone) {
    patch.tone = next.tone;
  }
  if (next.logline !== baseline.logline) {
    patch.logline = next.logline;
  }
  if (next.scriptMarkdown !== baseline.scriptMarkdown) {
    patch.scriptMarkdown = next.scriptMarkdown;
  }
  if (!sameJson(next.scenes, baseline.scenes)) {
    patch.scenes = next.scenes;
  }
  if (!sameJson(next.characters, baseline.characters)) {
    patch.characters = next.characters;
  }
  if (!sameJson(next.shots, baseline.shots)) {
    patch.shots = mergeShotsById(current?.shots ?? [], next.shots);
  }
  return patch;
}

/** 把会话内容写进 production。**只写内容列**——进度 / run / 评审是另外的字段
 *  所有者（画布 / run 引擎 / 评审器），桥不碰；行缺失时整行新建（带归属）。
 *  `executor` 供事务入口传入。
 *  `baseline`（ISSUE #4730）：会话加载时的内容快照。给出时按列比对、只写
 *  会话真正改过的列（shots 按 shotId 叠加合并），并跳过「无变化」的写——
 *  MCP 慢 IO 期间界面的并发改动不再被旧快照整列覆盖。缺省整包写（兼容）。 */
export async function writeContentToProduction(
  projectId: string,
  fallbackOwnerId: string,
  content: SessionContent,
  executor?: WorkshopExecutor,
  baseline?: SessionContent,
): Promise<void> {
  const exec = executor ?? workshopDb;
  if (baseline === undefined) {
    const values = { id: projectId, userId: fallbackOwnerId, ...contentColumns(content) };
    await exec
      .insert(production)
      .values(values)
      .onConflictDoUpdate({
        target: production.id,
        set: contentColumns(content),
      });
    return;
  }
  const currentRows = await exec
    .select()
    .from(production)
    .where(eq(production.id, projectId))
    .limit(1);
  const currentRow = currentRows[0];
  if (currentRow === undefined) {
    /* 行缺失（被外部删掉）：整行新建，无历史可覆盖。 */
    await exec
      .insert(production)
      .values({ id: projectId, userId: fallbackOwnerId, ...contentColumns(content) })
      .onConflictDoNothing({ target: production.id });
    return;
  }
  const currentContent: SessionContent = {
    title: currentRow.title,
    type: currentRow.type,
    tone: currentRow.tone,
    logline: currentRow.logline,
    scriptMarkdown: currentRow.scriptMarkdown,
    scenes: isSceneArray(currentRow.scenes) ? currentRow.scenes : [],
    characters: isCharacterArray(currentRow.characters) ? currentRow.characters : [],
    shots: isShotArray(currentRow.shots) ? currentRow.shots : [],
  };
  const patch = diffContentAgainstBaseline(baseline, content, currentContent);
  if (Object.keys(patch).length === 0) {
    return;
  }
  await exec.update(production).set(patch).where(eq(production.id, projectId));
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
    scenes: isSceneArray(row.scenes) ? row.scenes : [],
    characters: isCharacterArray(row.characters) ? row.characters : [],
    shots: isShotArray(row.shots) ? row.shots : [],
  };
}
