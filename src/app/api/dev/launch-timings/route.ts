import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { LAUNCH_STATUS_FILE, parseLaunchStatusText } from "~/lib/shell/launch-timings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 端点：GET /api/dev/launch-timings —— 回上一次启动的逐阶段耗时（#4327）。
 *
 * 数据是 `run/launch-status.json` 的 `timings`（编排器 timeline 写入，见
 * scripts/launcher-core/timeline.mjs）：启动页的耗时条随窗口交换一起消失，
 * 应用内（日志面板）据同一份读数把「启动时间花在哪一步」继续展示给用户。
 * 读不到文件 / 还没写到 timings / JSON 坏了都回 `{ phases: null }` 而非 404
 * ——「没有读数」是正常状态（纯浏览器开发、壳的兜底快照阶段），404 会被
 * 显示成接口挂了（§10.3.1）。
 */
export function GET() {
  const file = path.join(process.cwd(), "run", LAUNCH_STATUS_FILE);
  let phases: unknown = null;
  let totalMs: number | null = null;
  try {
    const parsed = parseLaunchStatusText(fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8"));
    if (parsed) {
      phases = parsed.phases;
      totalMs = parsed.totalMs;
    }
  } catch {
    /* 文件不存在 / JSON 坏了都归「没有读数」：消费方据此隐藏整卡。 */
  }
  return NextResponse.json({ phases, totalMs }, { headers: { "Cache-Control": "no-store" } });
}
