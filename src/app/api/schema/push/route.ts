import fs from "node:fs";
import { NextResponse } from "next/server";

import { spawnSchemaSync } from "../../../../../scripts/db-schema-state.mjs";
import { isRecord } from "~/lib/is-record";
import { SCHEMA_SYNC_STATUS_FILE } from "~/lib/log/log-paths";

/**
 * `POST /api/schema/push` —— 状态栏「立即同步」按钮的执行端：`stale` / `missing` 意味着启动时的自动同步没能把库带到当前 schema（dry-run 白名单判出这批变更含
 * 删列 / 重建表这类会丢数据的语句，启动链路不替用户决定），此前只能让用户去终端跑 `pnpm db:push`；本端点在确认弹窗后以 `--force` 口径 spawn 一次 `db-sync.mjs`，
 * 结果照旧写 `log/current/tools/schema-sync.json`（页面 2s 轮询原样拿到迁移，不引入第二条状态通道）。守卫三层、失败方向都是「不执行」：相位非 stale/missing → 409；`syncing` → 409（两个 drizzle 并发写同一库）；执行件不在（桌包刻意不带）→ 404，前端据 `canPush` 不显示按钮。
 */
export const dynamic = "force-dynamic";

/** 同进程内的并发闸：spawn 与子进程写下 `syncing` 之间有个窗口，双击会撞上。 */
let spawning = false;

export async function POST() {
  if (spawning) {
    return NextResponse.json({ ok: false, error: "已有一次同步在发起中" }, { status: 409 });
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
          phase === "syncing" ? "数据库正在同步中，请等它结束" : "当前没有需要同步的数据库结构变更",
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
