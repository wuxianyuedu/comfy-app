import { NextResponse } from "next/server";

import { getServerBootId, getServerRunId } from "~/lib/shell/dev-server-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 端点：GET /api/dev/server-id
 * 返回当前 dev server 进程的 bootId，以及**本次启动**的 runId。
 *
 * `bootId` 是「真正重启」判定的权威信号：进程每次冷启动重新生成一个 bootId，
 * 只要进程没重启它就不变。前端借此把「网络瞬时抖动导致的探测失败」与
 * 「dev server 进程真的重启」区分开，排除误报。
 *
 * `runId` 是 launcher 单点产出的启动标识（同一次启动里所有子进程共享），消息中心
 * 用它把历史消息按「每一次启动」分组——**多次启动的记录混在一起时，用户分不清
 * 哪几条属于同一次**（手验反馈）。它与 bootId 在**同一次探测**里回来是必然的：
 * 分成两次请求，会在「服务刚恢复」那一刻还拿着旧 runId，把恢复那条消息盖错组。
 *
 * 拿不到 runId 时给 null（纯手工 `pnpm dev` 没走 launcher），调用方按「未标记
 * 启动」处理，不编一个值。
 *
 * `dynamic = "force-dynamic"` 确保每次都读到进程当前的值，不做缓存。
 */
export async function GET() {
  return NextResponse.json({
    bootId: getServerBootId(),
    runId: getServerRunId(),
  });
}
