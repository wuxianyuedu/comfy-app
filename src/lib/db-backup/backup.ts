/* 数据库备份 / 恢复的**服务端取用口**（D6，ISSUE #1611）。
 *
 * ── 为什么这里是「薄封装」而不是第二份实现 ────────────────────────────────
 *
 * 备份必须发生在**会丢结构的同步之前**，而那一刻运行的是 `scripts/db-sync.mjs`
 * —— 一个由启动编排用裸 `node` spawn、只认 `.mjs` 的纯 Node 宿主（见
 * `db-schema-state.mjs` 文件头）。所以**真正的实现只有一份**，在
 * `scripts/db-backup-core.mjs`；本模块只做两件事：
 *
 *   1. 给它一层带类型的取用面（`.mjs` 不在 tsconfig 的扫描面里，接口靠这份
 *      声明收口 —— 与 `src/app/api/schema/push/route.ts` 取 `db-schema-state.mjs`
 *      同一形态）；
 *   2. 把「应用根」这个锚点收在这里，调用点不各自拼路径。
 *
 * 本模块**不重新实现**任何判据：命名、轮转选择、`integrity_check` 验证、标记
 * 读写、换文件全都只在那一个 `.mjs` 里。谁想改口径就改那里、连两侧一起生效
 * （§12.12 / §12.18）。
 *
 * ── §18.4 三选一：第一类（全部出口只能服务端用）──────────────────────────
 *
 * 它的每一个出口都要碰 `node:fs` / `node:sqlite`，而消费方只有 REST route 与
 * 启动链 —— 浏览器图无论如何都不该引它。声明形式的判定与登记见
 * `tests/lib-node-only-declarations.test.ts`。
 */
import "server-only";

import {
  BACKUP_KEEP,
  backupDir,
  createBackup,
  listBackups,
  pruneBackups,
  readRestoreRequest,
  requestRestore,
  verifyBackupFile,
} from "../../../scripts/db-backup-core.mjs";

export { BACKUP_KEEP, backupDir, createBackup, listBackups, pruneBackups };
export { readRestoreRequest, requestRestore, verifyBackupFile };

/** 一份可选备份在**界面上**的形状（不含绝对路径 —— 视图层不需要、也不该有）。 */
export type BackupEntry = {
  /** 文件名里的时刻（毫秒）；形态认不出时 null。 */
  at: number | null;
  name: string;
  size: number;
};

/** 备份目录里认得出的那批，新→旧。用户自己丢进来的文件不在其中。 */
export function listBackupEntries(root: string): Array<BackupEntry> {
  return listBackups(root).map((entry: BackupEntry) => ({
    name: entry.name,
    size: entry.size,
    at: entry.at,
  }));
}
