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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ensureSchemaCurrent,
  writeSchemaSyncStatus,
} from "./db-schema-state.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

writeSchemaSyncStatus(root, { phase: "syncing" });

const result = ensureSchemaCurrent(root, {
  forward: (chunk) => process.stderr.write(chunk),
});

writeSchemaSyncStatus(root, {
  phase: result.state,
  detail: result.detail ?? null,
});

process.stdout.write(
  `[db-sync] ${result.state}${result.detail ? `：${result.detail}` : ""}\n`,
);
