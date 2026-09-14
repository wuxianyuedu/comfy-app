import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { sql } from "drizzle-orm";
import { logger } from "~/server/lib/logger";
import { probeSchemaSync } from "~/lib/db-schema-ready";

/**
 * 健康检查端点：供外部探针（UptimeRobot / Grafana / 容器健康检查）使用。
 * - 不缓存，真实探活（SELECT 1 打库）
 * - 只暴露 ok/db 状态，不泄漏版本与内部细节
 *
 * 为什么还要探 schema：`SELECT 1` 只要**能打开库文件**就成功，而
 * `db.sqlite` 被留成 0 字节（`drizzle-kit push` 在无 TTY 上静默失败，
 * 见 scripts/db-push.mjs）时它照样回 `db: up`。探针因此会漏报整个
 * 「表没建」这一档：`/`、`/api/health` 都 200，只有真实业务路由 500
 * （`no such table`）——「看起来通了」比直接失败更难查（规范 §9.2 第 3 条）。
 * 现在把 schema 就绪度一并透出：表没建 = 503 + `db: empty`。
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const schema = probeSchemaSync();
  try {
    db.run(sql`select 1`);
    if (schema !== "ready") {
      logger.error({ schema }, "health_check_schema_not_ready");
      return NextResponse.json(
        {
          status: "error",
          db: schema === "missing" ? "empty" : "unknown",
          hint: "数据库表还没建：执行 pnpm db:push（见 docs/standards/launch-and-build.md §9.1）",
          t: new Date().toISOString(),
        },
        { status: 503 },
      );
    }
    return NextResponse.json({
      status: "ok",
      db: "up",
      t: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ err: error }, "health_check_failed");
    return NextResponse.json(
      { status: "error", db: "down", t: new Date().toISOString() },
      { status: 503 },
    );
  }
}
