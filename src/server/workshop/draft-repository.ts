// ── Workshop 前端项目草稿的服务端持久化（repository）─────────────
// 纯函数 draftToRow / rowToDto 不触碰 DB，便于单测；写读走 workshopDb。
// 该表与 AI/MCP 用的 workshopSession 并列，互不污染：id 直接复用前端
// 生成的 wsp_* 项目 id，应用重启后稳定不变，天然支持多项目按 id upsert。
import { desc, eq } from "drizzle-orm";
import { asRecord } from "~/lib/is-record";
import { parseDraftDto, type WorkshopDraftDto } from "~/lib/workshop/draft-sync-shared";
import {
  workshopDraft,
  type WorkshopDraft as WorkshopDraftRow,
  type WorkshopDraftInsert,
} from "~/server/db/schema";
import { workshopDb } from "./db";

/** 纯函数：线上草稿 → 可写行（不含 id / 时间戳）。 */
export function draftToRow(draft: WorkshopDraftDto): Partial<WorkshopDraftInsert> {
  return {
    title: draft.meta.title,
    type: draft.meta.type,
    tone: draft.meta.tone,
    logline: draft.meta.logline,
    scriptMarkdown: draft.scriptMarkdown,
    scenes: draft.scenes,
    characters: draft.characters,
    shots: draft.shots,
  };
}

/** 纯函数：行 → 线上草稿。 */
export function rowToDto(row: WorkshopDraftRow): WorkshopDraftDto {
  return parseDraftDto({
    meta: {
      title: row.title,
      type: row.type,
      tone: row.tone,
      logline: row.logline,
      scriptMarkdown: row.scriptMarkdown,
    },
    scriptMarkdown: row.scriptMarkdown,
    // scenes/characters/shots 是 JSON 列（unknown）：交给 parseDraftDto 的
    // isSceneList 等守卫判「是数组」这层（与旧断言同口径，非数组回落 []）。
    scenes: row.scenes,
    characters: row.characters,
    shots: row.shots,
  });
}

/** 读取某项目的服务端镜像；不存在返回 null。 */
export async function getDraft(id: string): Promise<WorkshopDraftDto | null> {
  const rows = await workshopDb
    .select()
    .from(workshopDraft)
    .where(eq(workshopDraft.id, id))
    .limit(1);
  return rows[0] ? rowToDto(rows[0]) : null;
}

/** 服务端镜像的项目摘要（列表恢复用：全量清空 localStorage 后按此重建索引）。 */
export type DraftSummary = {
  id: string;
  title: string;
  updatedAt: string;
};

/** 按用户列出其所有服务端镜像摘要（用于在本地索引缺失时把云端项目找回来）。 */
export async function listDraftsByUser(userId: string | null): Promise<Array<DraftSummary>> {
  const rows =
    userId !== null && userId !== ""
      ? await workshopDb
          .select({
            id: workshopDraft.id,
            title: workshopDraft.title,
            updatedAt: workshopDraft.updatedAt,
          })
          .from(workshopDraft)
          .where(eq(workshopDraft.userId, userId))
          .orderBy(desc(workshopDraft.updatedAt))
      : await workshopDb
          .select({
            id: workshopDraft.id,
            title: workshopDraft.title,
            updatedAt: workshopDraft.updatedAt,
          })
          .from(workshopDraft)
          .orderBy(desc(workshopDraft.updatedAt));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/** 新增或覆盖某项目的镜像（写穿式：前端每次自动保存都 upsert）。
 *  单语句 `onConflictDoUpdate`（ISSUE #3835）：id 是前端 wsp_* 主键，自动保存
 *  高频重复调用，「先查后插」在并发首存（双页签同时建项、保存与桥接赛跑）时
 *  会同抢主键让后到者 500 —— upsert 语义应当让重复执行成功且无害。 */
export async function upsertDraft(
  id: string,
  draft: WorkshopDraftDto,
  userId: string | null,
): Promise<void> {
  // insert 分支：补齐必填列（createdAt/updatedAt 由 drizzle 默认函数生成）。
  const insertRow: WorkshopDraftInsert = {
    id,
    userId: userId ?? null,
    title: draft.meta.title,
    type: draft.meta.type,
    tone: draft.meta.tone,
    logline: draft.meta.logline,
    scriptMarkdown: draft.scriptMarkdown,
    scenes: draft.scenes,
    characters: draft.characters,
    shots: draft.shots,
  };
  await workshopDb
    .insert(workshopDraft)
    .values(insertRow)
    .onConflictDoUpdate({
      target: workshopDraft.id,
      // update 分支：只改内容列（id / createdAt 不动）。
      set: {
        userId: insertRow.userId,
        title: insertRow.title,
        type: insertRow.type,
        tone: insertRow.tone,
        logline: insertRow.logline,
        scriptMarkdown: insertRow.scriptMarkdown,
        scenes: insertRow.scenes,
        characters: insertRow.characters,
        shots: insertRow.shots,
        updatedAt: new Date(),
      },
    });
}

/** 删除某项目的镜像（前端删除项目时同步清掉，避免残留孤行）。 */
export async function deleteDraft(id: string): Promise<boolean> {
  const result = await workshopDb.delete(workshopDraft).where(eq(workshopDraft.id, id));
  // node:sqlite 的 sqlite-proxy run 结果给 changes（libsql ResultSet 的 rowsAffected 已随驱动退场，#3171）：
  // drizzle 的 SqliteRemoteResult 类型只声明 rows，故按驱动实际返回形状取一次；
  // 只有数字才认，外来/异常值按 0 回落。
  const changes = asRecord(result)?.changes;
  return (typeof changes === "number" ? changes : 0) > 0;
}
