import { NextResponse } from "next/server";
import { getSystemStats } from "~/lib/comfyui/client";

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
  return NextResponse.json(stats ?? { online: false });
}
