import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { APP_SERVICE_EXIT_FILE } from "~/lib/shell/app-service-exit";
import { getServerRunId } from "~/lib/shell/dev-server-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 端点：GET /api/dev/last-exit —— 回上一次应用服务为什么结束（run/app-service-exit.json，ISSUE #1692）。只能在新进程应答后读回
 * （探活走 server-id，服务不在时必然不通），故不做「启动时清掉」；记录带结束那次的 runId 供调用方区分新旧。读不到文件回
 * `{ record: null }` 而非 404：「没原因」是正常状态，回 404 会被显示成接口挂了（§10.3.1）。
 */
export function GET() {
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
