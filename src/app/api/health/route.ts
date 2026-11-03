import { NextResponse } from "next/server";
import { pingDatabase } from "~/server/db";
import { logger } from "~/server/lib/logger";
import { probeSchemaSync } from "~/lib/db-schema-ready";
import { corsHeadersFor } from "~/lib/shell/splash-origin";

/**
 * 健康检查端点（外部探针用）：不缓存、真实探活（SELECT 1 打库），只暴露 ok/db 状态。
 * 还要探 schema：`SELECT 1` 在库文件 0 字节时照样成功（`drizzle-kit push` 无 TTY 静默失败，
 * 见 scripts/db-push.mjs），会漏报「表没建」整档（规范 §9.2 第 3 条）——表没建 = 503 + `db: empty`。
 */
export const dynamic = "force-dynamic";

/**
 * 数据库没就绪时给用户看的一句可行动的话：先说自己会好（桌包首启正是零表形态，把
 * `pnpm db:push` 摆第一句会推桌包用户去做做不到的事）；不写内部文档路径——本端点读者
 * 既有本机用户也有外部探针（经 CORS 回给任一源），没有一个是来读仓库文档的。
 */
const SCHEMA_HINT =
  "数据库表还没建好：应用会在启动时自动建表，稍候片刻；" +
  "仍未就绪时打开「设置 → 日志面板」看启动日志（开发检出里可执行 pnpm db:push）";

export async function GET(request: Request) {
  /* 跨域放行只给启动页那一族源（清单唯一事实源 `~/lib/shell/splash-origin`）：启动页要读
   * 真实状态码判就绪，no-cors 的 opaque 响应读不到（历史「过早导航」的根因）。此前是 `*`：
   * 理由是「无敏感信息」，但 503 响应体带着运维提示（曾含内部路径），前提不成立故收窄。 */
  const cors = corsHeadersFor(request.headers.get("origin"));
  const schema = probeSchemaSync();
  try {
    await pingDatabase();
    if (schema !== "ready") {
      logger.error({ schema }, "health_check_schema_not_ready");
      return NextResponse.json(
        {
          status: "error",
          db: schema === "missing" ? "empty" : "unknown",
          hint: SCHEMA_HINT,
          t: new Date().toISOString(),
        },
        { status: 503, headers: cors },
      );
    }
    return NextResponse.json(
      { status: "ok", db: "up", t: new Date().toISOString() },
      { headers: cors },
    );
  } catch (error) {
    logger.error({ err: error }, "health_check_failed");
    return NextResponse.json(
      { status: "error", db: "down", t: new Date().toISOString() },
      { status: 503, headers: cors },
    );
  }
}
