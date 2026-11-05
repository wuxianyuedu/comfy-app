import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import { isRecord } from "~/lib/is-record";
import { SCHEMA_SYNC_STATUS_FILE } from "~/lib/log/log-paths";

/**
 * `GET /api/schema` —— 后台 schema 同步的只读状态，供状态栏显示「同步中/已同步请刷新/需人工同步」。同步由启动脚本 spawn 的 `scripts/db-sync.mjs` 做（不阻塞启动），
 * 状态经磁盘文件 schema-sync.json 交接（两进程唯一交汇处）。拿不到状态一律回 `{ ok: false, phase: "unknown" }` 而非报错：没有提示 ≠ 出错。
 */
export const dynamic = "force-dynamic";

export function GET() {
  const file = SCHEMA_SYNC_STATUS_FILE;
  /* 「立即同步」按钮能不能显示：执行件在不在。桌包载荷刻意不带
   * `scripts/db-sync.mjs`（那里没有 drizzle-kit，跑了也没用，见
   * standalone-private-inputs.mjs 的白名单），状态栏据这个能力位回落成
   * 「跑 pnpm db:push」的纯提示，而不是一个点了必然 404 的按钮。 */
  const canPush = fs.existsSync(path.join(process.cwd(), "scripts", "db-sync.mjs"));
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (isRecord(parsed)) {
      return NextResponse.json({ ok: true, canPush, ...parsed });
    }
    return NextResponse.json({ ok: false, phase: "unknown", canPush });
  } catch {
    return NextResponse.json({ ok: false, phase: "unknown", canPush });
  }
}
