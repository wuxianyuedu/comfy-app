import { NextResponse } from "next/server";
import { pingDatabase } from "~/server/db";
import { logger } from "~/server/lib/logger";
import { probeSchemaSync } from "~/lib/db-schema-ready";
import { corsHeadersFor } from "~/lib/shell/splash-origin";

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

/**
 * 数据库没就绪时给用户看的一句**可行动**的话。
 *
 * 两条口径都是从「谁在读它」反推的：
 *   1. **先说自己会好**（`应用会在启动时自动建表`）—— 桌包首启的常规形态正是
 *      「入口在零表时应用随包的 `schema.sql`」，此刻用户什么都不必做，等一会
 *      再看就行。把 `pnpm db:push` 摆在第一句会把桌包用户推去做一件他做不到的
 *      事（没有 pnpm、也没有检出）。
 *   2. **不写内部文档路径**。此前那句是「…（见 `docs/standards/launch-and-build.md`
 *      §9.1）」—— 那是给维护者看的，而它经 CORS 回给**发起请求的任何一个源**。
 *      收窄白名单（见 `~/lib/shell/splash-origin`）之后泄漏面没了，但「响应体里
 *      不该出现内部路径」这条本身就该立住：本端点的读者既有本机用户、也有外部
 *      探针（UptimeRobot / Grafana / 容器健康检查），没有一个是来读仓库文档的。
 */
const SCHEMA_HINT =
  "数据库表还没建好：应用会在启动时自动建表，稍候片刻；" +
  "仍未就绪时打开「设置 → 日志面板」看启动日志（开发检出里可执行 pnpm db:push）";

export async function GET(request: Request) {
  /* 跨域放行只给启动页那一族源（`~/lib/shell/splash-origin` 是清单的唯一事实
   * 来源）：启动页要读**真实状态码**才能判就绪，no-cors 的 opaque 响应读不到
   * （那正是历史「过早导航」的根因），所以它必须走 cors 模式、必须拿到这个头。
   *
   * 此前这里是 `*`（任意源只读）。当时理由是「本端点只回 status/db/t，无敏感
   * 信息」—— 而 503 的响应体里其实带着上面那句运维提示（含内部文档路径）。
   * 「无敏感信息」这个前提不成立，所以按实际消费者收窄。 */
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
