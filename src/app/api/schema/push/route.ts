import fs from "node:fs";
import { NextResponse } from "next/server";

import { spawnSchemaSync } from "../../../../../scripts/db-schema-state.mjs";
import { isRecord } from "~/lib/is-record";
import { SCHEMA_SYNC_STATUS_FILE } from "~/lib/log/log-paths";

/**
 * `POST /api/schema/push` —— 状态栏「立即同步」按钮的执行端。
 *
 * 背景：`stale` / `missing` 意味着启动时的自动同步**没能**把库带到当前 schema
 * —— dry-run 白名单判出这批变更含「会丢数据」的语句（删列 / 重建表），启动链路
 * 不替用户做这个决定（`db-schema-state.mjs` 的 ensureSchemaCurrent）。此前唯一的
 * 出口是让用户自己去终端跑 `pnpm db:push`；本端点把这件事收进页面：用户在确认
 * 弹窗里知情并确认后，由本端点以 `--force` 口径 spawn 一次同步。
 *
 * 执行者仍是 `scripts/db-sync.mjs`（带 `--force`），结果照旧写状态文件
 * `log/current/tools/schema-sync.json` —— 页面现有的 2s 轮询链路原样拿到 `syncing → synced /
 * stale` 的迁移，本端点不引入第二条状态通道。
 *
 * 守卫（三层，失败方向都是「不执行」）：
 *   1. 状态文件里不是 `stale` / `missing` → 409（没有需要修的东西就不许发起）；
 *   2. 同步已在进行（`syncing`）→ 409（两个 drizzle 并发写同一个库）；
 *   3. `scripts/db-sync.mjs` 不在（桌包载荷刻意不带它，那里也没有 drizzle-kit）
 *      → 404，前端据 `GET /api/schema` 的 `canPush` 压根不显示按钮。
 */
export const dynamic = "force-dynamic";

/** 同进程内的并发闸：spawn 与子进程写下 `syncing` 之间有个窗口，双击会撞上。 */
let spawning = false;

export async function POST() {
  if (spawning) {
    return NextResponse.json(
      { ok: false, error: "已有一次同步在发起中" },
      { status: 409 },
    );
  }

  const file = SCHEMA_SYNC_STATUS_FILE;
  let current: unknown = null;
  try {
    current = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    /* 读不到状态文件 → current 保持 null，下面的相位守卫会挡下。 */
  }
  const phase = isRecord(current) ? current.phase : null;
  if (phase !== "stale" && phase !== "missing") {
    return NextResponse.json(
      {
        ok: false,
        error:
          phase === "syncing"
            ? "数据库正在同步中，请等它结束"
            : "当前没有需要同步的数据库结构变更",
      },
      { status: 409 },
    );
  }

  spawning = true;
  try {
    const started = spawnSchemaSync(process.cwd(), { force: true });
    if (!started.started) {
      return NextResponse.json(
        { ok: false, error: started.reason ?? "无法发起同步" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } finally {
    spawning = false;
  }
}
