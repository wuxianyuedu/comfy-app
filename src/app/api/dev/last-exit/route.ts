import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { APP_SERVICE_EXIT_FILE } from "~/lib/shell/app-service-exit";
import { getServerRunId } from "~/lib/shell/dev-server-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 端点：GET /api/dev/last-exit
 *
 * 回**上一次应用服务为什么结束**（`run/app-service-exit.json`，由启动编排在
 * 收尾定性时写下，见 `scripts/app-service-exit.mjs`）。ISSUE #1692：状态栏那一格
 * 翻成「应用服务已断开」时，用户还需要知道**为什么**。
 *
 * ## 为什么是「恢复之后才读得到」
 *
 * 探活走的是 `GET /api/dev/server-id`——那是应用服务自己的 HTTP，服务一不在它
 * 必然不通。所以这份记录不可能在断开的那一刻被读到：它只能在**新进程已经应答**
 * 之后读回，用来回答「刚才那次断开是因为什么」。
 *
 * ## 为什么记录不做「启动时清掉」
 *
 * 直觉上新服务起来就该清掉旧结论，但那样恰好把这个端点要读的东西清没了（读取
 * 只能发生在恢复之后）。陈旧记录不会造成误报：记录带着**结束那一次**的 runId，
 * 而当前进程的 runId 由 `COMFYAPP_RUN_ID` 透传进来（`scripts/dev-launcher.mjs`
 * 的 `process.env.COMFYAPP_RUN_ID = runId`）。调用方（`~/lib/shell/app-service-exit`
 * 的判据）据此区分「说的是上一份进程」与「说的是我现在这份」。本端点只如实回
 * 两方面事实：记了什么、当前 runId 是什么。
 *
 * 读不到文件回 `{ record: null }` 而不是 404：**这不是错误**，而是「没有原因可讲」
 * 这一正常状态（服务好好跑着 / 本次运行还没结束过）。回 404 会让面板把「没原因」
 * 显示成「接口挂了」——那正是 §10.3.1 要消灭的静默失败。
 */
export async function GET() {
  const file = path.join(process.cwd(), "run", APP_SERVICE_EXIT_FILE);
  let record: unknown;
  try {
    const raw = fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8");
    record = raw.trim() === "" ? null : JSON.parse(raw);
  } catch {
    /* 文件不存在 / JSON 坏了都归到「没有原因可讲」：这个端点的消费者是已经出
     * 故障时的界面，此时再抛一个错只会让现场更难查。 */
    record = null;
  }
  return NextResponse.json(
    { record, currentRunId: getServerRunId() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
