import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import { isRecord } from "~/lib/is-record";

/**
 * `GET /api/schema` —— 后台 schema 同步的**只读状态**，供底部状态栏显示
 * 「数据库同步中 / 已同步请刷新 / 需人工同步」。
 *
 * 为什么要有一段「后台同步」：启动脚本拉起 Next 的**同时** spawn
 * `scripts/db-sync.mjs` 做一次结构核对与同步（不阻塞启动，session 见
 * `scripts/db-schema-state.mjs` 的 `spawnSchemaSync`）。同步期间库结构可能还是
 * 旧的，业务请求会 500 —— 页面必须能说出「正在同步，稍候刷新」，否则用户只会
 * 看到一个报错页面，没法判断该等还是该去查别的原因。
 *
 * 状态由那个**子进程**写进 `log/schema-sync.json`（`writeSchemaSyncStatus`），
 * 由本进程读出来 —— 两者唯一的交汇处就是磁盘，所以不走内存。
 *
 * 拿不到状态（还没同步过 / 产物里没有这个能力 / 文件被删）一律回
 * `{ ok: false, phase: "unknown" }` 而**不是**报错：没有提示 ≠ 出错，
 * 状态栏据此什么都不显示。
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const file = path.join(process.cwd(), "log", "schema-sync.json");
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (isRecord(parsed)) {
      return NextResponse.json({ ok: true, ...parsed });
    }
    return NextResponse.json({ ok: false, phase: "unknown" });
  } catch {
    return NextResponse.json({ ok: false, phase: "unknown" });
  }
}
