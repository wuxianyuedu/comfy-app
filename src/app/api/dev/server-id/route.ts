import { NextResponse } from "next/server";
import { getServerBootId } from "~/lib/dev-server-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/dev/server-id
 * 返回当前 dev server 进程的 bootId。
 *
 * 这是「真正重启」判定的权威信号：进程每次冷启动重新生成一个 bootId，
 * 只要进程没重启它就不变。前端借此把「网络瞬时抖动导致的探测失败」与
 * 「dev server 进程真的重启」区分开，排除误报。
 *
 * `dynamic = "force-dynamic"` 确保每次都读到进程当前的 bootId，不做缓存。
 */
export async function GET() {
  return NextResponse.json({ bootId: getServerBootId() });
}
