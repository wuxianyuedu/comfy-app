import { NextResponse } from "next/server";

import { collectComfyQueueStatus } from "~/lib/comfyui/queue-status.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 端点：GET /api/comfy/queue
 *
 * 底部状态栏那一格的轮询端点：ComfyUI 的全局排队数 + 本应用当前在跑的任务
 * （工作流名 / 模型 / 开始时刻 / 进度）。与 `/api/comfy/stats` 同款：
 * `force-dynamic` 保证每次真实采集，不做 GET 缓存。
 *
 * ComfyUI 不可达时 `online: false`（前端显示「离线」而不是留个空位）。
 */
export async function GET() {
  return NextResponse.json(await collectComfyQueueStatus());
}
