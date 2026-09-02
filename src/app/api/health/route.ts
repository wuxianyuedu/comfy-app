import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { sql } from "drizzle-orm";
import { logger } from "~/server/lib/logger";

/**
 * 健康检查端点：供外部探针（UptimeRobot / Grafana / 容器健康检查）使用。
 * - 不缓存，真实探活（SELECT 1 打库）
 * - 只暴露 ok/db 状态，不泄漏版本与内部细节
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    db.run(sql`select 1`);
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
