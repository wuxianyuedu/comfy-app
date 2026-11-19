// 本机应用数据（`data/` 顶层文件）的**备份 / 恢复 / 导入**实现（ISSUE #3732）。
//
// #3732 之前，设置页的备份只覆盖数据库（`VACUUM INTO` 的单文件快照）；
// 本机应用数据（`data/` 下的应用设置、模式契约本机覆盖、侧栏行为、密钥文件等）
// 不在备份范围内——换机器 / 回滚时它们就丢了。本模块把这一块补上：
//
//   · **备份**：把 `data/` 顶层文件（排除 `backups/`）拷进
//     `data/backups/app-data-backup-<时刻>/`，与同刻的数据库快照配成一套；
//   · **恢复**：沿用「两步制」——点按钮只写标记，真正覆盖发生在下次启动
//     （应用没在跑）。覆盖前把当前的 `data/` 文件先存一份退路；
//   · **导入**：从用户指定的目录把备份件拷回 `data/backups/`（认 `db-backup-*.sqlite`
//     与 `app-data-backup-*`，其余文件不动），导入后照常出现在清单里。
//
// 与数据库备份（`db-backup-core.mjs`）的分工：数据库那份的唯一实现仍在
// `db-backup-core.mjs`；本模块只管 `data/` 文件这一半。恢复的编排（标记 → 换库 →
// 换应用数据）由 `db-backup-core.mjs` 的 `applyPendingRestore` 串起来；本模块的
// 导入校验由调用方注入 `verify`（`db-backup-core.mjs` 的 `verifyBackupFile`）——
// 单向依赖，不互相 import。
//
// 三态退码与既有脚本同口径：0 成功 / 1 失败 / 2 没判（前提不全）。
import fs from "node:fs";
import path from "node:path";

/** 应用数据目录（相对应用根）。与 `db-backup-core.mjs` 的 `BACKUP_DIR` 同一层。 */
export const APP_DATA_DIR = "data";

/** 本机应用数据备份的目录名前缀：`app-data-backup-<YYYYMMDD>-<HHmmss>[-<n>]`。 */
export const APP_DATA_BACKUP_PREFIX = "app-data-backup-";

/** 名字形态：`app-data-backup-<时刻>[-<第几次>]`（目录）。 */
const APP_DATA_DIR_RE =
  /^app-data-backup-(?<stampText>\d{4}\d{2}\d{2}-\d{2}\d{2}\d{2})(?:-(?<ordinal>\d+))?$/;

/** 恢复前退路目录的前缀：`app-data-pre-restore-<时刻>`。 */
const PRE_RESTORE_PREFIX = "app-data-pre-restore-";

/** 备份目录的绝对路径（与 `db-backup-core.mjs` 的 `backupDir` 同一落点）。
 *  @param {string} root 应用根
 *  @returns {string} */
export function backupsDir(root) {
  return path.join(root, "data", "backups");
}

/**
 * 要备份的本机应用数据文件清单（`data/` 顶层文件；`backups/` 排除）。
 *
 * 刻意**只收顶层文件**、不递归子目录：`data/` 下目前没有需要整目录搬运的子树，
 * 而递归会把将来的缓存 / 日志目录也卷进备份。真出现那种子树时再在这里显式加。
 *
 * @param {string} root 应用根
 * @returns {{ file: string, name: string }[]} 绝对路径 + 相对名
 */
export function listAppDataFiles(root) {
  const dir = path.join(root, APP_DATA_DIR);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  /** @type {{ file: string, name: string }[]} */
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    files.push({ file: path.join(dir, entry.name), name: entry.name });
  }
  return files;
}

/** 时刻段（`YYYYMMDD-HHmmss`），与数据库备份的命名同口径。
 *  @param {Date} now @returns {string} */
function stampOf(now) {
  /** 两位补零。 @param {number} n 数字 @returns {string} */
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

/**
 * 把本机应用数据拷进 `data/backups/app-data-backup-<时刻>/`。
 *
 * 与数据库备份**同一刻**调用（同一个 `now`），两份合成一套完整备份。
 * `data/` 里一样文件都没有时返回 `ok: false, nothing: true` —— 不是失败，
 * 是「没有可备的应用数据」（全新安装的合法状态）。
 *
 * @param {string} root 应用根
 * @param {{ now?: Date, keep?: number }} [options]
 * @returns {{ ok: true, name: string, dir: string, files: number, bytes: number, pruned: string[] }
 *          | { ok: false, nothing: true }
 *          | { ok: false, reason: string }}
 */
export function createAppDataBackup(root, options = {}) {
  const now = options.now ?? new Date();
  const keep = options.keep ?? 3;
  const files = listAppDataFiles(root);
  if (files.length === 0) {
    return { ok: false, nothing: true };
  }
  const backups = backupsDir(root);
  let target;
  try {
    fs.mkdirSync(backups, { recursive: true });
    let ordinal = 1;
    for (;;) {
      target = path.join(
        backups,
        `${APP_DATA_BACKUP_PREFIX}${stampOf(now)}${ordinal > 1 ? `-${ordinal}` : ""}`,
      );
      if (!fs.existsSync(target)) break;
      ordinal += 1;
    }
    fs.mkdirSync(target, { recursive: true });
  } catch (error) {
    return { ok: false, reason: `备份目录不可写：${messageOf(error)}` };
  }
  let bytes = 0;
  let copied = 0;
  for (const file of files) {
    try {
      fs.copyFileSync(file.file, path.join(target, file.name));
      bytes += fs.statSync(path.join(target, file.name)).size;
      copied += 1;
    } catch (error) {
      return { ok: false, reason: `拷不动 ${file.name}：${messageOf(error)}` };
    }
  }
  if (copied === 0) {
    return { ok: false, nothing: true };
  }
  const name = path.basename(target);
  const pruned = pruneAppDataBackups(root, keep);
  return { ok: true, name, dir: target, files: copied, bytes, pruned };
}

/**
 * 列出本机应用数据的备份套（新→旧）。
 *
 * @param {string} root 应用根
 * @returns {{ name: string, dir: string, at: number | null, files: number, bytes: number }[]}
 */
export function listAppDataBackups(root) {
  const dir = backupsDir(root);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  /** @type {{ name: string, dir: string, at: number | null, files: number, bytes: number }[]} */
  const sets = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !APP_DATA_DIR_RE.test(entry.name)) continue;
    const setDir = path.join(dir, entry.name);
    let files = 0;
    let bytes = 0;
    try {
      for (const item of fs.readdirSync(setDir)) {
        try {
          bytes += fs.statSync(path.join(setDir, item)).size;
          files += 1;
        } catch {
          /* 恰好被删掉的一份不计 */
        }
      }
    } catch {
      continue;
    }
    const stamp = APP_DATA_DIR_RE.exec(entry.name)?.[1] ?? null;
    const at = stamp
      ? new Date(
          Number(stamp.slice(0, 4)),
          Number(stamp.slice(4, 6)) - 1,
          Number(stamp.slice(6, 8)),
          Number(stamp.slice(9, 11)),
          Number(stamp.slice(11, 13)),
          Number(stamp.slice(13, 15)),
        ).getTime()
      : null;
    sets.push({ name: entry.name, dir: setDir, at, files, bytes });
  }
  sets.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  return sets;
}

/**
 * 轮转本机应用数据的备份套：删掉最老的、超出保留套数的那批（与数据库备份
 * 同一节奏）。**只删认得出的名字** —— 用户自己丢进 `data/backups/` 的目录不动。
 *
 * @param {string} root 应用根
 * @param {number} keep 保留套数
 * @param {readonly string[]} protect 绝不删的名字（正在被恢复 / 被当作退路的）
 * @returns {string[]} 真的删掉的名字
 */
export function pruneAppDataBackups(root, keep, protect = []) {
  const dir = backupsDir(root);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const sets = entries
    .filter((e) => e.isDirectory() && APP_DATA_DIR_RE.test(e.name))
    .map((e) => e.name)
    .filter((name) => !protect.includes(name));
  sets.sort((a, b) => b.localeCompare(a));
  const removed = [];
  for (const name of sets.slice(Math.max(0, keep))) {
    try {
      fs.rmSync(path.join(dir, name), { recursive: true, force: true });
      removed.push(name);
    } catch {
      /* 删不掉（被占用）不算失败：只是多留一套，不反过来影响新备份。 */
    }
  }
  return removed;
}

/**
 * 恢复本机应用数据：把 `app-data-backup-*` 里的文件拷回 `data/`。
 *
 * 覆盖前先把当前 `data/` 顶层文件存一份退路（`app-data-pre-restore-<时刻>/`）——
 * 与数据库恢复的「先做退路备份」同一条纪律。
 *
 * @param {string} root 应用根
 * @param {string} dirName 备份套名（`app-data-backup-…`，必须是 listAppDataBackups 里那批之一）
 * @param {{ now?: Date }} [options]
 * @returns {{ ok: true, files: number, safety: string }
 *          | { ok: false, reason: string, safety: string | null }}
 */
export function restoreAppDataBackup(root, dirName, options = {}) {
  const now = options.now ?? new Date();
  const source = path.join(backupsDir(root), dirName);
  if (!APP_DATA_DIR_RE.test(dirName) || !fs.existsSync(source)) {
    return { ok: false, reason: `找不到这份本机应用数据备份：${dirName}`, safety: null };
  }
  const dataDir = path.join(root, APP_DATA_DIR);
  const safety = path.join(backupsDir(root), `${PRE_RESTORE_PREFIX}${stampOf(now)}`);
  try {
    fs.mkdirSync(safety, { recursive: true });
    for (const file of listAppDataFiles(root)) {
      fs.copyFileSync(file.file, path.join(safety, file.name));
    }
    fs.mkdirSync(dataDir, { recursive: true });
    for (const item of fs.readdirSync(source)) {
      fs.copyFileSync(path.join(source, item), path.join(dataDir, item));
    }
  } catch (error) {
    return { ok: false, reason: `恢复失败：${messageOf(error)}`, safety: null };
  }
  return { ok: true, files: 0, safety: path.basename(safety) };
}

/**
 * 从**用户指定的目录**导入备份件（ISSUE #3732：另一台机器 / 移动盘上的备份）。
 *
 * 认两类：`db-backup-*.sqlite`（逐份过调用方注入的 `verify`，坏的跳过并记原因）
 * 与 `app-data-backup-*` 目录。同名（冲突）时不覆盖 —— 换成带来源标记的新名字。
 *
 * @param {string} root 应用根
 * @param {string} fromDir 用户指定的目录
 * @param {{ verify: (file: string) => { ok: true } | { ok: false, reason: string } }} options
 *   `verify` 由调用方注入（`db-backup-core.mjs` 的 `verifyBackupFile`，integrity_check）。
 * @returns {{ ok: true, imported: string[], skipped: string[] }
 *          | { ok: false, reason: string, imported: string[], skipped: string[] }}
 */
export function importBackupFromDir(root, fromDir, options) {
  const verify = options.verify;
  const source = String(fromDir ?? "").trim();
  let entries;
  try {
    entries = fs.readdirSync(source, { withFileTypes: true });
  } catch (error) {
    return { ok: false, reason: `读不到这个目录：${messageOf(error)}`, imported: [], skipped: [] };
  }
  const backups = backupsDir(root);
  const imported = [];
  const skipped = [];
  fs.mkdirSync(backups, { recursive: true });
  for (const entry of entries) {
    const target = path.join(backups, entry.name);
    if (fs.existsSync(target)) {
      skipped.push(`${entry.name}（data/backups 里已有同名）`);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".sqlite")) {
      const file = path.join(source, entry.name);
      const verdict = verify(file);
      if (!verdict.ok) {
        skipped.push(`${entry.name}（${verdict.reason}）`);
        continue;
      }
      fs.copyFileSync(file, target);
      imported.push(entry.name);
      continue;
    }
    if (entry.isDirectory() && APP_DATA_DIR_RE.test(entry.name)) {
      fs.cpSync(path.join(source, entry.name), target, { recursive: true });
      imported.push(entry.name);
    }
  }
  if (imported.length === 0 && skipped.length === 0) {
    return {
      ok: false,
      reason: "这个目录里没有认得出的备份件（要 db-backup-*.sqlite 或 app-data-backup-*）",
      imported: [],
      skipped: [],
    };
  }
  return { ok: true, imported, skipped };
}

/** 异常 → 一句话（与 `db-backup-core.mjs` 的 `messageOf` 同口径，不另立一份）。
 *  @param {unknown} error
 *  @returns {string} */
function messageOf(error) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : String(error);
  return code === "" ? message : `${code} ${message}`;
}
