#!/usr/bin/env node
// 手动做一份数据库备份（`pnpm db:backup`）—— D6 建议默认①里「另留手动档」的落点。
//
// 自动那一档只在 `--force` 同步之前发生（`db-sync.mjs`）；这条命令给「没在动
// schema、但我想先留一手」的场合（比如准备手工改库、或跑一个不确定的迁移脚本）。
//
// 输出分两路：给人看的进度走 stdout（含失败原因与下一步），一份状态走退出码
// （0 = 备份好了且验通了，1 = 没有）。
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BACKUP_KEEP, backupNotice, createBackup } from "./db-backup-core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const result = createBackup(root, {
  /* 轮转删不掉时也要说一句（硬规则 4）：它不是备份失败，但磁盘上确实多留了。 */
  onRotateFail: (name, error) => {
    process.stderr.write(
      `[db:backup] 轮转时删不掉 ${name}（${
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : String(error)
      }）—— 备份本身没受影响，只是多留了一份。\n`,
    );
  },
});

const notice = backupNotice(result);
for (const line of notice?.lines ?? []) process.stdout.write(`${line}\n`);

if (result.ok) {
  process.stdout.write(
    `[db:backup] 落点：${result.file}（保留最近 ${BACKUP_KEEP} 份，本机私有目录、不入版本控制）\n`,
  );
  process.exit(0);
}
process.stdout.write(
  "[db:backup] 没有产出备份。常见原因：库文件还没建（先跑 pnpm db:push）、磁盘满、\n" +
    "[db:backup] 或库文件被别的进程独占。修好之后重跑本命令即可。\n",
);
process.exit(1);
