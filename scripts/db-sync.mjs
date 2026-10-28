#!/usr/bin/env node
// 后台做一次 schema 同步（**不阻塞启动**），并把结果写成一份状态文件。
//
// 谁调用：`dev.mjs` / `start.mjs` / `dev-launcher.mjs` 在拉起 Next 的**同时**
// spawn 本脚本，并且**不等它返回**。此前是「先同步、再起 Next」——drizzle 一轮
// 约 17 秒、同步一次 15~30 秒，用户要盯着空窗等半分钟才看到页面；现在等待时间
// 还给用户，期间页面自己会说「正在同步」。
//
// 「同步中」这件事必须让**页面**也知道（否则用户看到的是业务页面 500，无从判断
// 该等还是该去跑命令）：结果写进 `log/schema-sync.json`，服务端 `GET /api/schema`
// 读它透出，状态栏据此显示「同步中 / 已同步请刷新 / 需人工同步」。
//
// 判据与 `pnpm db:push` 同一份（`db-schema-state.mjs` 的 `ensureSchemaCurrent`）：
// 只自动应用「建表 / 建索引 / 加列」，含丢数据语句的一律交人工 —— 启动链路不替
// 用户做那种决定。
//
// 输出分两路：人类可读的进度走 stderr（被启动脚本重定向进
// `log/schema-sync.log`），状态文件走 `log/schema-sync.json`。
//
// **`--force` 之前先做一档自动备份**（D6 / ISSUE #1611 的建议默认①）：`--force`
// 是唯一会跑「删列 / 重建表」的那条路，也是唯一一次失误不可逆的时刻，而它此前
// **零备份**。备份失败**不阻断**同步（那是用户已经确认过的动作），但会把原因讲
// 出来 —— 让「这次变更万一丢了数据、目前没有退路」这件事至少是可读的。
import path from "node:path";

import { backupNotice, createBackup } from "./db-backup-core.mjs";
import {
  ensureSchemaCurrent,
  writeSchemaSyncStatus,
} from "./db-schema-state.mjs";

const root = path.resolve(import.meta.dirname, "..");

/* `--force`：跳过 dry-run 白名单按 `pnpm db:push` 的口径直接应用（含丢数据语句）。
 * 唯一调用方是 POST /api/schema/push —— 用户已在状态栏的确认弹窗里知情并确认；
 * 启动链路 spawn 本脚本时**不带**这个参数，决策权仍归人。 */
const force = process.argv.includes("--force");

writeSchemaSyncStatus(root, { phase: "syncing" });

/* 只在 `--force` 这一路自动备份：非 `--force`（启动链路的自动同步）按白名单
 * 只认建表 / 建索引 / 加列，不会丢数据 —— 每次都备份会让 `data/backups/` 被
 * 「一次正常启动」填满，3 份保留量反而挤掉真正有价值的那几份。 */
if (force) {
  const notice = backupNotice(createBackup(root), { why: "执行会丢结构的同步" });
  for (const line of notice?.lines ?? []) {
    process.stderr.write(`[db-sync] ${line}\n`);
  }
}

const result = ensureSchemaCurrent(root, {
  forward: (chunk) => process.stderr.write(chunk),
  force,
});

writeSchemaSyncStatus(root, {
  phase: result.state,
  detail: result.detail ?? null,
});

process.stdout.write(
  `[db-sync] ${result.state}${result.detail ? `：${result.detail}` : ""}\n`,
);
