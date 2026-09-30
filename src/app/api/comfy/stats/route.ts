import { NextResponse } from "next/server";

import { getSystemStats } from "~/lib/comfyui/client";
import { getComfyRuntimeSnapshot } from "~/lib/comfyui/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 端点：GET /api/comfy/stats
 * 底部状态栏的轮询端点：代理 ComfyUI `/system_stats`，返回显存/内存占用。
 * ComfyUI 未运行时返回 `{ online: false }`，前端据此显示「离线」。
 * `dynamic = "force-dynamic"` 保证每次都真实探活，不做 GET 缓存。
 */
export async function GET() {
  const stats = await getSystemStats();
  if (stats !== null) {
    return NextResponse.json({ ...stats, processAlive: true });
  }
  /* HTTP 没读到 ≠ 没在跑：与 `/api/comfy/queue` 同一口径（queue-status.server.ts
   * 的快照回落）—— ComfyUI 跑图 GPU 满载时 `/system_stats` 会连续超时，只认
   * HTTP 会把「正在生成」闪报成「未运行」。进程级快照不依赖 ComfyUI 的 HTTP
   * 响应能力；快照的 unverified（进程表也查失败）不当作在跑。 */
  const snap = await getComfyRuntimeSnapshot();
  return NextResponse.json({ online: false, processAlive: snap.running });
}
