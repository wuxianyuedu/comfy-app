// 历史数据格式的一次性清洗（纯 Node 宿主，`.mjs`）。
//
// 起因（ISSUE #1501）：`project` 表里同时存在两种 `createdAt` / `updatedAt`
// 写法 —— 裸毫秒串（`1787379642808`）与 ISO 串（`2026-09-23T12:55:34.886Z`）。
// 前者是更早的时代由 `Date.now()` 直写进去的沉积行，写入侧如今一律走
// `schema.ts` 的 `dateNotNull.toDriver` → `toISOString()`，所以那不是活路径，
// 而是**读进来就得当成脏数据挡着**的历史痕迹：
//   · `dateNotNull.fromDriver` 里 `new Date("1787379642808")` 是 Invalid Date，
//     任何按它算时间的地方拿到的都是 NaN；
//   · 排序 / 时间档位函数各自再兜一遍，重复且口径容易漂。
//
// 处理方式刻意是**归一而不是删行**：这些行的 id 是客户端画布 id，删掉等于把
// 用户的画布从服务端抹掉（本地索引还在，下次自动保存又会把它带回来）。把两种
// 写法收成同一份，读取侧就只剩一条路径。
//
// 判据：本脚本只认「整串十进制数字」这一种形状（`/^\d+$/`），且只改
// **能解析成合法时间**的行 —— 形状没见过的值原样留着并打出来，交人看。
// 只在真的改了东西时才写盘（幂等：第二次跑是空操作）。
//
// 调用方：`scripts/db-push.mjs`（`pnpm db:push` 收尾）。只在显式跑命令时执行，
// 启动链路不做数据改写 —— 那是「替用户改数据」，与自动应用 DDL 不是一回事。
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

/** 时间列一律 ISO 文本（见 `src/server/db/schema.ts` 的 `dateNotNull`）。 */
const ISO_COLUMNS = ["createdAt", "updatedAt"];

/** 「整串十进制数字」= 旧时代裸毫秒写法的唯一形状判据。
 *  刻意不写 `Number.isFinite(Number(v))`：后者会把 `" 12 "`、`"1e3"`、
 *  `""` 一并认成数字，而那些形状一旦出现，说明列里还有第三种东西要人看。 */
const EPOCH_MS = /^\d{1,17}$/;

/**
 * 裸毫秒串 → ISO 串；不是这个形状、或解不出合法时间时返回 null（原样保留）。
 * @param {unknown} value 列里的原值
 * @returns {string | null}
 */
export function epochMsToIso(value) {
  if (typeof value !== "string" || !EPOCH_MS.test(value)) return null;
  const ms = Number(value);
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/**
 * 清一遍库里的历史时间戳写法。
 *
 * @param {string} dbPath 库文件绝对路径
 * @param {(line: string) => void} [forward] 进度输出（默认 stdout）
 * @returns {{ rows: number, columns: number, skipped: string[] }}
 *   `rows` / `columns`：改动的行数与列数；`skipped`：形状没见过、原样留下的值
 */
export function sweepLegacyTimestamps(
  dbPath,
  forward = (/** @type {string} */ l) => process.stdout.write(l),
) {
  /** @type {{ rows: number, columns: number, skipped: string[] }} */
  const summary = { rows: 0, columns: 0, skipped: [] };
  if (!fs.existsSync(dbPath)) {
    forward("[db:sweep] 库文件不存在，跳过（没什么可清的）\n");
    return summary;
  }
  let db;
  try {
    db = new DatabaseSync(dbPath, { open: true });
  } catch (error) {
    /* 读不到库不算错：清洗是「顺手做的整理」，不该让 `pnpm db:push` 失败。 */
    const detail = error instanceof Error ? error.message : "unknown";
    forward(`[db:sweep] 打不开库（${detail}），跳过本次清洗\n`);
    return summary;
  }
  try {
    const hasProject = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='project'",
      )
      .get();
    if (!hasProject) {
      forward("[db:sweep] 还没有 project 表，跳过\n");
      return summary;
    }
    const columns = db
      .prepare("PRAGMA table_info(project)")
      .all()
      .map((row) => String(row.name));
    /** @type {string[]} */
    const pick = ISO_COLUMNS.filter((name) => columns.includes(name));
    if (pick.length === 0) {
      forward("[db:sweep] project 表里没有时间列，跳过\n");
      return summary;
    }

    const rows = db.prepare(`SELECT id, ${pick.join(", ")} FROM project`).all();
    /** @type {{ id: string, column: string, iso: string }[]} */
    const updates = [];
    for (const row of rows) {
      const id = String(row.id ?? "");
      for (const column of pick) {
        const raw = row[column];
        if (typeof raw !== "string" || raw === "") continue;
        const iso = epochMsToIso(raw);
        if (iso) {
          updates.push({ id, column, iso });
          continue;
        }
        /* 已经是 ISO / 或形状没见过：前者是目标形态，后者要人看。 */
        if (Number.isNaN(new Date(raw).getTime())) {
          summary.skipped.push(`${id}.${column} = ${raw}`);
        }
      }
    }

    if (updates.length === 0) {
      forward("[db:sweep] 没有裸毫秒时间戳，跳过写入\n");
    } else {
      /** @type {Map<string, ReturnType<DatabaseSync["prepare"]>>} */
      const stmt = new Map(
        pick.map((column) => [
          column,
          db.prepare(`UPDATE project SET ${column} = ? WHERE id = ?`),
        ]),
      );
      db.exec("BEGIN");
      try {
        for (const { id, column, iso } of updates) {
          stmt.get(column)?.run(iso, id);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      summary.rows = new Set(updates.map((u) => u.id)).size;
      summary.columns = updates.length;
      forward(
        `[db:sweep] ✓ 归一 ${summary.rows} 行的裸毫秒时间戳（共 ${summary.columns} 列）\n`,
      );
    }

    for (const line of summary.skipped) {
      forward(
        `[db:sweep] ⚠ 时间列里有解析不了的值，原样保留待人工确认：${line}\n`,
      );
    }
    return summary;
  } finally {
    db.close();
  }
}

/* 直接执行时按 `DATABASE_URL` 定位库（与 `db-push.mjs` / `src/server/db.ts`
 * 同一锚点：去 `file:` 前缀后相对项目根解析）。被 import 时不自动跑。 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const url = process.env.DATABASE_URL ?? "file:./db.sqlite";
  const raw = url.startsWith("file:") ? url.slice("file:".length) : url;
  sweepLegacyTimestamps(path.resolve(root, raw));
}
