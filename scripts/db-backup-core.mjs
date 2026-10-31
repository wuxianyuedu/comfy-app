// 数据库备份 / 恢复的**唯一实现**（纯 Node 宿主，`.mjs`）。
//
// 为什么是 `.mjs` 而不是 `src/lib/**` 的 `.ts`：调用它的一侧是
// `scripts/db-sync.mjs` —— 那个脚本由启动编排用 `process.execPath`（**裸 node**）
// spawn、只认 `.mjs`（见 `db-schema-state.mjs` 文件头）。备份必须发生在
// **会丢结构的同步之前**，而那一刻正是这个纯 Node 进程里。TS 侧（设置页那条路）
// 反过来 import 本模块（先例：`src/app/api/schema/push/route.ts` import
// `db-schema-state.mjs`）—— **实现只有一份**，不在两侧各写一遍（§12.12 / §12.18）。
//
// ── 为什么是 `VACUUM INTO` 而不是在线 `backup()` ──────────────────────────
//
// D6 台账原文写「复用 better-sqlite3 现成的在线 `backup()`」，那条方案在
// **运行时不存在**：`better-sqlite3` 是 `devDependencies`（测试基建），生产走
// `@libsql/client`，而它**没有** `backup()`（`Client` 只有 `execute` /
// `transaction` / `sync` / `close`）。
//
// `VACUUM INTO '<path>'` 是 SQLite 自带的、**一条语句**就能拿到一致性单文件快照
// 的机制。实测（本仓 `@libsql/client` 与 `node:sqlite` 两条链、WAL 模式下都验过）：
//   · 产物是**单文件**，不带 `-wal` / `-shm`；
//   · 产物 `PRAGMA integrity_check` 回 `ok`，表数据可读；
//   · WAL 里**尚未 checkpoint** 的已提交数据也在产物里（这正是「直接 copy
//     `db.sqlite`」做不到的那一点）。
//
// ── 判据三条（全部对着机器事实，不是「文件存在」）──────────────────────────
//   1. 产物能被 `integrity_check` 读通；
//   2. `-wal` / `-shm` 不进备份（`VACUUM INTO` 天然如此，这里**用例钉住**）；
//   3. 库被占用 / 读不出时**给出可见出口**（硬规则 4），不静默失败。
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { resolveSqlitePath } from "./db-schema-state.mjs";

/** 备份落点（相对应用根）：`<应用根>/data/backups/`。
 *
 *  为什么是 `data/`：它**已经就是**本机私有状态的既定落点（`data/app-settings.json`、
 *  `data/llm-secret.key`、`data/runtime-secret.json` 都在这层），`.gitignore` 收
 *  `/data/`，`standalone-private-inputs.mjs` 的 `PRIVATE_INPUTS` 还会把它从分发
 *  产物里剥掉。
 *
 *  **为什么不放「项目根旁边」**：生产里 `process.cwd()` 就是**安装目录**
 *  （NSIS per-user 装到 `%LOCALAPPDATA%\<产品名>`），而下一次安装 / 更新会覆盖
 *  安装清单里的文件 —— 备份放那儿会被一次升级带走。 */
export const BACKUP_DIR = path.join("data", "backups");

/** 保留份数（建议默认②：最近 3 份）。
 *
 *  迁移不常有，3 份足够覆盖「连着两次迁移都出事」，又不会让 `data/` 长成第二个库。 */
export const BACKUP_KEEP = 3;

/** 备份文件名前缀：`db-backup-<YYYYMMDD>-<HHmmss>[-<n>].sqlite`。 */
const BACKUP_PREFIX = "db-backup-";

/** 名字里的时刻段（紧凑日期 + 时分秒），与 `runtime-log-file.ts` 同口径
 *  （无冒号 —— Windows 下 `:` 是非法文件名字符）。 */
const STAMP_RE = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/;

/** 名字形态：`db-backup-<时刻>[-<第几次>].sqlite`。 */
const BACKUP_FILE_RE = /^db-backup-(\d{4}\d{2}\d{2}-\d{2}\d{2}\d{2})(?:-(\d+))?\.sqlite$/;

/** 一次备份落点的绝对目录。
 *  @param {string} root 应用根
 *  @returns {string} */
export function backupDir(root) {
  return path.join(root, BACKUP_DIR);
}

/** 时刻段（`YYYYMMDD-HHmmss`，无冒号，可直接进文件名）。
 *  @param {Date} at
 *  @returns {string} */
function stamp(at) {
  /** @param {number} n @returns {string} */
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}` +
    `-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`
  );
}

/**
 * 一份备份的文件名。
 *
 * `ordinal` 给「同一秒内不止一次备份」分叉（`-2` / `-3`），不覆盖前一份 ——
 * 与 `runtime-log-file.ts` 同一条形态判据。
 *
 * @param {Date} at
 * @param {number} [ordinal]
 * @returns {string}
 */
export function backupFileName(at, ordinal = 1) {
  const suffix = ordinal > 1 ? `-${ordinal}` : "";
  return `${BACKUP_PREFIX}${stamp(at)}${suffix}.sqlite`;
}

/**
 * @typedef {{ startedAt: number | null, ordinal: number }} ParsedBackupName
 */

/**
 * 解析一份备份的文件名；不是这个形态时返回 null。
 *
 * 读取侧**按名字**认（与 `parseRuntimeLogFileName` 同款）：备份目录里可能有用户
 * 自己丢进来的文件，那些不该被轮转删掉、也不该出现在「可选备份」清单里。
 *
 * @param {string} name
 * @returns {ParsedBackupName | null}
 */
export function parseBackupFileName(name) {
  const m = BACKUP_FILE_RE.exec(name);
  if (!m) {
    return null;
  }
  const [, stampText, ordinalText] = m;
  const sm = STAMP_RE.exec(stampText ?? "");
  if (!sm) {
    return null;
  }
  const [, y, mo, d, h, mi, s] = sm;
  const startedAt = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
  ).getTime();
  const ordinal = ordinalText ? Number(ordinalText) : 1;
  return {
    startedAt: Number.isFinite(startedAt) ? startedAt : null,
    ordinal: Number.isFinite(ordinal) && ordinal > 0 ? ordinal : 1,
  };
}

/**
 * 按保留份数挑出「该删的那批」（纯函数，不碰磁盘）。
 *
 * 排序三级：时刻新→前；同秒按 ordinal 大→前；再同则按名字倒序（保证确定性）。
 * 只收认得出的备份名 —— 别的文件一律不动（用户丢进来的东西不许被程序删）。
 *
 * @param {string[]} names 目录里的文件名
 * @param {number} [keep]
 * @param {readonly string[]} [protect] **绝不删**的名字（恢复换文件时用：
 *   那份正在被恢复的备份不能被紧接着做退路备份的轮转删掉 —— 否则
 *   「先备份、再复制」这个顺序会在中间把源文件弄丢）
 * @returns {string[]} 该删的文件名（新→旧之外的那批）
 */
export function selectBackupsToPrune(names, keep = BACKUP_KEEP, protect = []) {
  /** @type {{ name: string, parsed: ParsedBackupName }[]} */
  const known = [];
  for (const name of names) {
    const parsed = parseBackupFileName(name);
    if (parsed !== null) {
      known.push({ name, parsed });
    }
  }
  known.sort((a, b) => {
    const at = a.parsed.startedAt ?? 0;
    const bt = b.parsed.startedAt ?? 0;
    if (at !== bt) {
      return bt - at;
    }
    if (a.parsed.ordinal !== b.parsed.ordinal) {
      return b.parsed.ordinal - a.parsed.ordinal;
    }
    return b.name.localeCompare(a.name);
  });
  /** 被保护的名字**不占保留份数**：它不是「最近 N 份」里的一份，是必须留着的。 */
  const protectedSet = new Set(protect);
  const candidates = known.filter((e) => !protectedSet.has(e.name));
  return candidates.slice(Math.max(0, keep)).map((e) => e.name);
}

/**
 * @typedef {{ name: string, file: string, size: number, at: number | null }} BackupEntry
 */

/**
 * 列出现有备份（新→旧），只含认得出的名字。
 *
 * @param {string} root 应用根
 * @returns {BackupEntry[]}
 */
export function listBackups(root) {
  const dir = backupDir(root);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  /** @type {BackupEntry[]} */
  const entries = [];
  for (const name of names) {
    const parsed = parseBackupFileName(name);
    if (parsed === null) {
      continue;
    }
    const file = path.join(dir, name);
    let size;
    try {
      size = fs.statSync(file).size;
    } catch {
      continue; // 恰好被轮转删掉 / 读不到：不算可选备份
    }
    entries.push({ name, file, size, at: parsed.startedAt });
  }
  entries.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  return entries;
}

/**
 * @typedef {{ ok: true, file: string, name: string, size: number, pruned: string[] }
 *         | { ok: false, reason: string }} BackupResult
 */

/**
 * 把库热备份到 `data/backups/`，**并验产物真的能读通**。
 *
 * 用 `VACUUM INTO`：一条语句产出一致性单文件快照，不停应用、不带 `-wal` / `-shm`。
 * 写在**临时名**上，验完再改名成最终名 —— 中途失败（磁盘满 / 库坏了）不会在
 * 备份目录里留下一个「看着像备份、其实读不通」的文件：那正是台账里说的
 * **「备份看着有了，真要恢复时那份已经坏了」**，比没有备份更危险。
 *
 * 成功返回 `{ ok: true, ... }`；失败返回 `{ ok: false, reason }` —— **不抛**，
 * 由调用方决定怎么说（硬规则 4：失败路径必须有日志 + 用户可见出口；备份失败
 * 不该让同步本身崩掉，但也不能不声不响地跳过）。
 *
 * @param {string} root 应用根
 * @param {{ databaseUrl?: string, now?: Date, keep?: number,
 *           onRotateFail?: (name: string, error: unknown) => void,
 *           protect?: readonly string[] }} [options]
 *   `protect` 是**绝不删**的名字（见 `selectBackupsToPrune`）—— 恢复路径用它
 *   保住「正在被恢复的那一份」，否则轮转会在「先做退路、再换文件」中间把它删掉。
 * @returns {BackupResult}
 */
export function createBackup(root, options = {}) {
  const { databaseUrl, now = new Date(), keep = BACKUP_KEEP, protect = [] } = options;
  const source = resolveSqlitePath(root, databaseUrl);
  if (!fs.existsSync(source)) {
    return { ok: false, reason: "数据库文件还不存在，没有什么可备份的" };
  }

  const dir = backupDir(root);
  let target;
  let tmp;
  try {
    fs.mkdirSync(dir, { recursive: true });
    /* 同秒内第二次备份不覆盖第一份（`-2`），与文件名形态同一条判据。 */
    let ordinal = 1;
    for (;;) {
      target = path.join(dir, backupFileName(now, ordinal));
      if (!fs.existsSync(target)) {
        break;
      }
      ordinal += 1;
    }
    tmp = `${target}.partial`;
    if (fs.existsSync(tmp)) {
      fs.unlinkSync(tmp);
    }
  } catch (error) {
    return { ok: false, reason: `备份目录不可写：${messageOf(error)}` };
  }

  try {
    /* 逐字路径进 SQL 字面量：SQLite 的 `VACUUM INTO` 只收字符串字面量，收不了
     * 绑定参数（旧版本甚至只收字面量）。路径里的单引号因此必须转义 ——
     * 不转义时 Windows 用户名含 `'` 一类会让整条语句语法错误，而报错指向的是
     * VACUUM 而不是「你的目录名」。（转义用 SQL 标准写法：`''`。） */
    const literal = tmp.replace(/'/g, "''");
    const db = new DatabaseSync(source, { readOnly: false, open: true });
    try {
      db.exec(`VACUUM INTO '${literal}'`);
    } finally {
      db.close();
    }
  } catch (error) {
    cleanup(tmp);
    return { ok: false, reason: `VACUUM INTO 失败：${messageOf(error)}` };
  }

  /* 验产物**能读通**，而不是「文件存在」：这是台账判据的第 1 条。
   * 只读打开 + `integrity_check`，顺带数一次表数（0 张表的「备份」是空壳）。 */
  const verify = verifyBackupFile(tmp);
  if (!verify.ok) {
    cleanup(tmp);
    return { ok: false, reason: `备份产物读不通：${verify.reason}` };
  }

  try {
    fs.renameSync(tmp, target);
  } catch (error) {
    cleanup(tmp);
    return { ok: false, reason: `备份改名失败：${messageOf(error)}` };
  }

  /* 轮转：按次命名 + 轮转是一对（硬规则 4）。删失败不算备份失败 —— 备份已经
   * 落盘可用了，删不掉只意味着磁盘上多留一份，如实记进 `pruned` 之外的通路。 */
  const pruned = pruneBackups(root, keep, options.onRotateFail, protect);
  return {
    ok: true,
    file: target,
    name: path.basename(target),
    size: verify.size,
    pruned,
  };
}

/**
 * 验一份备份文件：只读打开 + `integrity_check` + 数表数。
 *
 * @param {string} file
 * @returns {{ ok: true, size: number, tables: number } | { ok: false, reason: string }}
 */
export function verifyBackupFile(file) {
  let size;
  try {
    size = fs.statSync(file).size;
  } catch (error) {
    return { ok: false, reason: `读不到文件（${messageOf(error)}）` };
  }
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true, open: true });
  } catch (error) {
    return { ok: false, reason: `打不开（${messageOf(error)}）` };
  }
  try {
    const row = db.prepare("PRAGMA integrity_check").get();
    /* `integrity_check` 正常时回**一行 `ok`**；有损坏时回一行行的问题描述。 */
    const verdict = String(row?.integrity_check ?? "");
    if (verdict !== "ok") {
      return { ok: false, reason: `integrity_check 回「${verdict}」` };
    }
    const count = db
      .prepare(
        "SELECT count(*) AS c FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .get();
    const tables = Number(count?.c ?? 0);
    if (tables === 0) {
      return { ok: false, reason: "产物里一张表都没有（空壳，不是快照）" };
    }
    return { ok: true, size, tables };
  } catch (error) {
    return { ok: false, reason: `查询失败（${messageOf(error)}）` };
  } finally {
    db.close();
  }
}

/**
 * 按保留份数轮转：删掉最老的、认得出的那批。
 *
 * **只删认得出的名字** —— 用户自己丢进 `data/backups/` 的文件不在射程内。
 *
 * @param {string} root 应用根
 * @param {number} [keep]
 * @param {((name: string, error: unknown) => void) | undefined} [onFail] 单个删不掉时的出口
 * @param {readonly string[]} [protect] 绝不删的名字（见 `selectBackupsToPrune`）
 * @returns {string[]} 真的删掉的那批（文件名）
 */
export function pruneBackups(root, keep = BACKUP_KEEP, onFail, protect = []) {
  const dir = backupDir(root);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const removed = [];
  for (const name of selectBackupsToPrune(names, keep, protect)) {
    try {
      fs.unlinkSync(path.join(dir, name));
      removed.push(name);
    } catch (error) {
      /* 删不掉（被杀毒 / 索引器占着句柄）不该影响备份本身，但也不能装作没发生
       * （硬规则 4）—— 如实交给调用方的出口。 */
      onFail?.(name, error);
    }
  }
  return removed;
}

/** 失败的清理：删不掉也不改变结论（结论已经由返回值给出）。
 *  @param {string} file */
function cleanup(file) {
  try {
    if (file && fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  } catch {
    /* 留着一个 `.partial` 比抛错好：它名字里就有「不完整」，下一次备份会覆盖它 */
  }
}

/** 异常 → 一句话（`errno` 码优先，它是唯一能在 Windows 上分辨原因的东西）。
 *  @param {unknown} error
 *  @returns {string} */
function messageOf(error) {
  if (error && typeof error === "object" && "code" in error && error.code) {
    return `${String(error.code)}${"message" in error ? ` ${String(error.message)}` : ""}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/* ── 恢复：只写标记，换文件交给「应用没在跑」的那一刻 ────────────────────────
 *
 * 为什么不在点按钮时就换文件：本项目**运行期会有多个进程同时持有这个库**
 * （内嵌 Next server、执行宿主，以及用户可能正开着的 Drizzle Studio）。运行期
 * 直接覆盖 `db.sqlite` = 在别人握着句柄时换掉文件 —— 轻则新连接读到半份，
 * 重则 `database disk image is malformed`。
 *
 * 所以形态与既有先例**同形**（`POST /api/schema/push` 那套三层守卫）：设置页
 * 「点按钮」只写一个**待恢复标记**，「真正换文件」落在启动链上、Next 起来之前
 * —— 那个时刻天然满足「应用没在跑」，不用另造一把锁。
 */

/** 待恢复标记的文件名（落在备份目录里，与备份同一处可见）。 */
export const RESTORE_MARKER = "restore-request.json";

/** 待恢复标记的绝对路径。
 *  @param {string} root 应用根
 *  @returns {string} */
export function restoreMarkerPath(root) {
  return path.join(backupDir(root), RESTORE_MARKER);
}

/**
 * 写待恢复标记。**不检查应用在不在跑** —— 换文件不在这里发生（见上）。
 *
 * 守卫（与 `/api/schema/push` 同款「失败方向是不执行」）：
 *   · 目标必须**是**这个目录里认得出的备份名（不接受任意路径 —— 那等于把
 *     「恢复」变成「用任意文件覆盖数据库」）；
 *   · 目标必须存在且**能读通**（`integrity_check`）—— 让一份坏备份覆盖掉好库
 *     是不可逆的；宁可当场告诉用户「这份备份是坏的」。
 *
 * @param {string} root 应用根
 * @param {unknown} name 备份文件名（**不是路径**，必须是 `listBackups` 里那批之一）
 * @param {{ now?: Date }} [options]
 * @returns {{ ok: true, marker: string } | { ok: false, reason: string }}
 */
export function requestRestore(root, name, options = {}) {
  if (typeof name !== "string" || parseBackupFileName(name) === null) {
    return { ok: false, reason: `不是一份备份的名字：${String(name)}` };
  }
  const file = path.join(backupDir(root), name);
  if (!fs.existsSync(file)) {
    return { ok: false, reason: `找不到这份备份：${name}` };
  }
  const verify = verifyBackupFile(file);
  if (!verify.ok) {
    return { ok: false, reason: `这份备份读不通（${verify.reason}），不能用它覆盖数据库` };
  }
  const marker = restoreMarkerPath(root);
  try {
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(
      marker,
      `${JSON.stringify({ file: name, at: (options.now ?? new Date()).toISOString() })}\n`,
      "utf8",
    );
    return { ok: true, marker };
  } catch (error) {
    return { ok: false, reason: `写不了待恢复标记：${messageOf(error)}` };
  }
}

/** 有没有待恢复的请求（读取侧只回答「哪一份」，不碰数据库）。
 *  @param {string} root 应用根
 *  @returns {{ file: string, at: string | null } | null} */
export function readRestoreRequest(root) {
  try {
    const parsed = JSON.parse(fs.readFileSync(restoreMarkerPath(root), "utf8"));
    const name = parsed && typeof parsed.file === "string" ? parsed.file : null;
    if (name === null || parseBackupFileName(name) === null) {
      return null;
    }
    return {
      file: name,
      at: typeof parsed.at === "string" ? parsed.at : null,
    };
  } catch {
    return null;
  }
}

/**
 * @typedef {{ status: "nothing-to-do" }
 *         | { status: "restored", from: string, safetyBackup: string | null }
 *         | { status: "failed", reason: string, from: string | null }} RestoreResult
 */

/**
 * **真正换文件的那一步** —— 只在启动链、Next 起来之前调用。
 *
 * 四步，每一步的失败方向都是「不动数据库」：
 *   1. 有标记吗（没有 = 空转，绝大多数启动都是这一支）；
 *   2. 标记指的那份备份**现在还能读通吗**（标记可能是几天前写的，用户后来把
 *      备份删了 / 盘坏了）；
 *   3. **先给当前库做一份备份** —— 恢复本身也是一次不可逆操作，「恢复回错了」
 *      时人得有退路。这一步失败就**不换**（宁可让用户重来，也不要把唯一的
 *      退路丢掉）；
 *   4. 删旧的 `-wal` / `-shm`，把备份文件拷过去（**拷贝而不是改名**：备份要
 *      留着 —— 恢复完也得能再恢复一次）。
 *
 * @param {string} root 应用根
 * @param {{ databaseUrl?: string, now?: Date }} [options]
 * @returns {RestoreResult}
 */
export function applyPendingRestore(root, options = {}) {
  const request = readRestoreRequest(root);
  if (request === null) {
    return { status: "nothing-to-do" };
  }

  const from = request.file;
  const source = path.join(backupDir(root), from);
  const verify = verifyBackupFile(source);
  if (!verify.ok) {
    return {
      status: "failed",
      from,
      reason: `待恢复的那份备份读不通（${verify.reason}）`,
    };
  }

  const dbFile = resolveSqlitePath(root, options.databaseUrl);
  /* 当前库不存在时不需要保底备份（没有东西可以被覆盖掉）—— 这一档也是「从备份
   * 恢复到一台新机器」的正当用法。 */
  const existed = fs.existsSync(dbFile);
  let safety = null;
  if (existed) {
    const created = createBackup(root, {
      databaseUrl: options.databaseUrl,
      now: options.now,
      /* **正在被恢复的那一份绝不能进轮转的删除名单**：轮转是紧接着做的，
       * 而换文件还在下一步。实测过这个错法 —— 退路备份把 `now` 推到了当前
       * 时刻，轮转按「最近 N 份」一算，被恢复那一份正好落在名单上，
       * 于是下一步 `copyFileSync` 报 ENOENT、库没换成，而**退路已经做了**。 */
      protect: [from],
    });
    if (!created.ok) {
      return {
        status: "failed",
        from,
        reason: `换文件之前没能给当前库留一份退路（${created.reason}），因此没有动它`,
      };
    }
    safety = created.name;
  }

  try {
    /* WAL / SHM 必须删掉：它们的 salt 与主库 header 绑定，换主库之后留着它们
     * 会被 SQLite 判成不匹配 —— 轻则忽略，重则 `database disk image is
     * malformed`（`guide-database-backup.md` §3.2 记录过这个现场）。 */
    for (const side of [`${dbFile}-wal`, `${dbFile}-shm`]) {
      try {
        if (fs.existsSync(side)) {
          fs.unlinkSync(side);
        }
      } catch (error) {
        return {
          status: "failed",
          from,
          reason: `删不掉 ${path.basename(side)}（${messageOf(error)}）—— 它还在被占用，说明应用没停干净`,
        };
      }
    }
    fs.copyFileSync(source, dbFile);
  } catch (error) {
    return { status: "failed", from, reason: `换文件失败：${messageOf(error)}` };
  }

  /* 标记用完即销：换完还留着它，下一次启动会把同一份备份再覆盖一遍 —— 而那时
   * 用户已经在新库上干了一天的活。 */
  try {
    fs.unlinkSync(restoreMarkerPath(root));
  } catch {
    /* 删不掉不算失败：最坏的后果是下次启动又恢复一次，而那时 `safety` 会先把
     * 当时的库备份下来 —— 数据不丢，只是多一步。 */
  }

  return { status: "restored", from, safetyBackup: safety };
}

/**
 * 把恢复结果翻成给用户看的行（启动链三个入口共用一句话，别各写一份）。
 *
 * @param {RestoreResult} result
 * @returns {{ level: "info" | "warn", lines: string[] } | null}
 */
export function restoreNotice(result) {
  switch (result.status) {
    case "nothing-to-do":
      return null;
    case "restored":
      return {
        level: "info",
        lines: [
          `数据库已从备份恢复（${result.from}）。` +
            (result.safetyBackup
              ? `恢复前的那一份已另存为 ${result.safetyBackup}，需要回退时可在设置页选它。`
              : ""),
        ],
      };
    default:
      return {
        level: "warn",
        lines: [
          `数据库恢复没能完成：${result.reason}。`,
          result.from
            ? `待恢复的那份（${result.from}）与标记都保留着 —— 下次启动会再试一次。`
            : "启动会继续使用当前数据库。",
        ],
      };
  }
}

/**
 * 把备份结果翻成给用户看的行（同上）。
 *
 * @param {BackupResult} result
 * @param {{ why?: string }} [context] `why` = 「为什么这次要做备份」（同步 / 恢复前）
 * @returns {{ level: "info" | "warn", lines: string[] } | null}
 */
export function backupNotice(result, context = {}) {
  const why = context.why ? `${context.why}前` : "";
  if (result.ok) {
    return {
      level: "info",
      lines: [
        `${why}已自动备份数据库：${result.name}` +
          (result.pruned.length > 0
            ? `（按最近 ${BACKUP_KEEP} 份轮转，删掉 ${result.pruned.length} 份更早的）`
            : ""),
      ],
    };
  }
  return {
    level: "warn",
    lines: [
      `${why}的自动备份**没能完成**：${result.reason}。`,
      "这次同步照常继续 —— 但请知悉：万一这次变更丢了数据，目前没有这一份可以回退。",
    ],
  };
}

/**
 * 启动链的**唯一调用点**：换文件 + 把结果打到启动日志。
 *
 * 三个入口（`dev.mjs` / `start.mjs` / `dev-launcher.mjs`）都要做同一件事，且都
 * 必须排在**任何会打开数据库的东西之前**（Next、执行宿主、后台 schema 同步）。
 * 收成一个函数而不是三处各写一遍：`restoreNotice` 的分支一旦分叉，就会出现
 * 「哪里启动的才说得出恢复失败」这种最难查的形态。
 *
 * 不抛：换文件失败不该让应用起不来（那时用户至少还能进设置页重试）。
 *
 * @param {string} root 应用根
 * @param {{ write?: (line: string) => void }} [options] `write` 默认 stderr
 * @returns {RestoreResult}
 */
export function applyPendingRestoreAtBoot(root, options = {}) {
  const write = options.write ?? ((line) => process.stderr.write(line));
  /** @type {RestoreResult} */
  let result;
  try {
    result = applyPendingRestore(root);
  } catch (error) {
    result = {
      status: "failed",
      from: null,
      reason: `恢复流程异常：${messageOf(error)}`,
    };
  }
  const notice = restoreNotice(result);
  for (const line of notice?.lines ?? []) {
    write(`[db-backup] ${line}\n`);
  }
  return result;
}
