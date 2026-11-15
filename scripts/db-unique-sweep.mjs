// 唯一索引上线前的存量重复数据清洗（纯 Node 宿主，`.mjs`）。
//
// 起因（ISSUE #3849「唯一性检测」）：给四组业务键补唯一索引 ——
//   · workflowModelTag_workflowTemplate (workflowModelTag, workflowTemplate)
//   · character (seriesId, name)
//   · season (seriesId, seasonNumber)
//   · episode (seasonId, episodeNumber)
// 存量库里若已有重复行，`drizzle-kit push` 的 `CREATE UNIQUE INDEX` 会直接失败，
// 所以清洗必须排在 push **之前**（`db-push.mjs` 调用）。
// task 的「同镜头活动任务唯一」**没有**对应的唯一索引（drizzle-kit 0.31 对
// 部分 / 表达式索引永不收敛，见 schema.ts task 表注释），但存量重复活动任务
// 仍然要清 —— 那是重复扣款形态的现场：下面的 task 步骤把它一并清掉。
//
// 处置原则（与 `db-legacy-sweep.mjs` 同一条：能不动用户内容就不动）：
//   · season / episode 重复序号 → **重编号**（保留每行内容，只改号；
//     UI 建季/建集此前一律落默认号 1，重复是常态路径，删行等于删用户内容）；
//   · character 同名重复 → 删后到的行（保留最早一行；promoteFromProduction
//     本来就按 name 合并，重复行只会让合并命中其一）；
//   · 连接表重复对 → 删后到的重复对（纯垃圾行，无内容）；
//   · task 同镜头的活动任务重复（重复扣款形态）→ **取消**后到者
//     （写 CANCELLED + finishedAt，不删行、不丢追溯记录）。
//
// 幂等：已清洗过的库（三个删重步骤有唯一索引兜底）再次跑是空操作；task 步骤
// 在没有库级约束的情况下靠「只留最早一条活动任务」的判据天然幂等。
// 只在显式 `pnpm db:push` 时执行；启动链路不做数据改写（那是「替用户改数据」，
// 与自动应用 DDL 不是一回事）——库里有重复而直接走启动链路的用户会收到
// push 失败提示，按提示跑一次 `pnpm db:push` 即完成清洗 + 建索引。
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

/** 库里有没有这张表。 */
function hasTable(db, table) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table);
  return row !== undefined;
}

/**
 * 同组内序号重复的行重编号：组内按 rowid（≈创建顺序）走，首次出现的号保留，
 * 之后的重复行依次拿「当前最大号 +1」。内容零丢失，编号恢复唯一。
 *
 * @param {DatabaseSync} db
 * @param {string} table 表名（无需转义：调用方传入的是字面表名）
 * @param {string} groupCol 组列（seriesId / seasonId）
 * @param {string} numCol 序号列（seasonNumber / episodeNumber）
 * @param {(line: string) => void} forward 输出
 * @returns {number} 改写的行数
 */
function renumberDuplicates(db, table, groupCol, numCol, forward) {
  if (!hasTable(db, table)) {
    return 0;
  }
  const dupGroups = db
    .prepare(
      `SELECT ${groupCol} AS g FROM ${table} GROUP BY ${groupCol}, ${numCol} HAVING COUNT(*) > 1`,
    )
    .all()
    .map((r) => String(r.g));
  if (dupGroups.length === 0) {
    return 0;
  }
  const listStmt = db.prepare(
    `SELECT id, ${numCol} AS n FROM ${table} WHERE ${groupCol} = ? ORDER BY rowid`,
  );
  const updStmt = db.prepare(`UPDATE ${table} SET ${numCol} = ? WHERE id = ?`);
  let changed = 0;
  db.exec("BEGIN");
  try {
    for (const g of dupGroups) {
      const rows = listStmt.all(g);
      const seen = new Set();
      let max = 0;
      for (const r of rows) {
        const n = Number(r.n);
        if (Number.isFinite(n) && n > max) {
          max = n;
        }
      }
      for (const r of rows) {
        if (!seen.has(r.n)) {
          seen.add(r.n);
          continue;
        }
        max += 1;
        updStmt.run(max, String(r.id));
        changed += 1;
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  if (changed > 0) {
    forward(`[db:unique-sweep] ✓ ${table}：${changed} 行序号重复，已重编号（内容未动）\n`);
  }
  return changed;
}

/**
 * 清一遍「即将加唯一索引的业务键」上的存量重复。
 *
 * @param {string} dbPath 库文件绝对路径
 * @param {(line: string) => void} [forward] 进度输出（默认 stdout）
 * @returns {{ deleted: number, renumbered: number, cancelled: number }}
 */
export function sweepDuplicateRowsForUniqueIndexes(
  dbPath,
  forward = (/** @type {string} */ l) => process.stdout.write(l),
) {
  /** @type {{ deleted: number, renumbered: number, cancelled: number }} */
  const summary = { deleted: 0, renumbered: 0, cancelled: 0 };
  if (!fs.existsSync(dbPath)) {
    forward("[db:unique-sweep] 库文件不存在，跳过\n");
    return summary;
  }
  let db;
  try {
    db = new DatabaseSync(dbPath, { open: true });
  } catch (error) {
    /* 打不开库这里不吞：排在本 sweep 之后的 push 一样打不开，让它带着真因失败。 */
    const detail = error instanceof Error ? error.message : "unknown";
    forward(`[db:unique-sweep] 打不开库（${detail}），跳过清洗（push 会带着同一原因失败）\n`);
    return summary;
  }
  try {
    // ① 连接表重复对：同一 (标签, 模板) 只留最早一行（#3835/#3870 的现场）。
    if (hasTable(db, "workflowModelTag_workflowTemplate")) {
      const r = db
        .prepare(
          `DELETE FROM workflowModelTag_workflowTemplate
           WHERE rowid NOT IN (
             SELECT MIN(rowid) FROM workflowModelTag_workflowTemplate
             GROUP BY workflowModelTag, workflowTemplate
           )`,
        )
        .run();
      if (r.changes > 0) {
        forward(`[db:unique-sweep] ✓ 连接表：删 ${r.changes} 行重复 (标签, 模板) 对\n`);
      }
      summary.deleted += Number(r.changes);
    }

    // ② 同系列同名角色：保留最早一行，删后到的（引用它的 episode_character
    //    随外键级联清理；production 里的 JSON 角色卡按 name 合并语义读）。
    if (hasTable(db, "character")) {
      const r = db
        .prepare(
          `DELETE FROM "character"
           WHERE rowid > (
             SELECT MIN(c2.rowid) FROM "character" AS c2
             WHERE c2.seriesId = "character".seriesId AND c2.name = "character".name
           )`,
        )
        .run();
      if (r.changes > 0) {
        forward(`[db:unique-sweep] ✓ 角色：删 ${r.changes} 行同名重复（各保留最早一行）\n`);
      }
      summary.deleted += Number(r.changes);
    }

    // ③ / ④ 季号、集号重复：重编号，不删行（UI 建季/集此前一律落默认号 1）。
    summary.renumbered += renumberDuplicates(db, "season", "seriesId", "seasonNumber", forward);
    summary.renumbered += renumberDuplicates(db, "episode", "seasonId", "episodeNumber", forward);

    // ⑤ 同镜头的活动任务重复：后到者取消（重复扣款形态；不删行）。
    if (hasTable(db, "task")) {
      const r = db
        .prepare(
          `UPDATE task SET status = 'CANCELLED', finishedAt = ?
           WHERE status IN ('QUEUED', 'RUNNING')
             AND projectId IS NOT NULL AND shotId IS NOT NULL
             AND rowid > (
               SELECT MIN(t2.rowid) FROM task AS t2
               WHERE t2.projectId = task.projectId AND t2.shotId = task.shotId
                 AND t2.status IN ('QUEUED', 'RUNNING')
             )`,
        )
        .run(new Date().toISOString());
      if (r.changes > 0) {
        forward(`[db:unique-sweep] ✓ 任务：取消 ${r.changes} 条同镜头的重复活动任务\n`);
      }
      summary.cancelled += Number(r.changes);
    }

    if (summary.deleted + summary.renumbered + summary.cancelled === 0) {
      forward("[db:unique-sweep] 没有存量重复行，跳过\n");
    }
    return summary;
  } finally {
    db.close();
  }
}

/* 直接执行时按 `DATABASE_URL` 定位库（与 `db-legacy-sweep.mjs` 同一锚点与同一套
 * 「是否直接执行」判据：两侧都过 `path.resolve`，不拼 `file://${argv[1]}`）。 */
{
  const path = await import("node:path");
  const invokedDirectly =
    process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
  if (invokedDirectly) {
    const root = path.resolve(import.meta.dirname, "..");
    const url = process.env.DATABASE_URL ?? "file:./db.sqlite";
    const raw = url.startsWith("file:") ? url.slice("file:".length) : url;
    sweepDuplicateRowsForUniqueIndexes(path.resolve(root, raw));
  }
}
