import { NextResponse } from "next/server";

import { getServerBootId, getServerRunId } from "~/lib/shell/dev-server-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 环回主机名：探活跨源放行的白名单（#4195，来源构造见
 * `~/lib/shell/dev-server-probe-url`——页面在 localhost / ::1 上时探活改打
 * 127.0.0.1，对浏览器是跨源 fetch，必须回显 Origin 才能读到响应体）。 */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * 环回同端口来源的 CORS 回显头。
 *
 * 只放行「回环主机 + 与本服务同端口」的来源：本应用是单用户本机服务，
 * bootId / runId 是诊断读数，但也不必对任意网页开放——局域网来源、其它
 * 端口的来源一律不带 CORS 头（浏览器按同源策略拦下，不影响既有的同源
 * 调用方）。`serverPort` 由调用方从请求的 Host 头解出后注入，判据纯函数化
 * 便于直接断言。
 */
export function loopbackCorsHeaders(
  origin: string | null,
  serverPort: string,
): Record<string, string> {
  if (origin === null || origin === "") {
    return {};
  }
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return {};
  }
  const hostname = parsed.hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (!LOOPBACK_HOSTNAMES.has(hostname)) {
    return {};
  }
  if (parsed.port !== serverPort) {
    return {};
  }
  return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
}

/** 从 Host 头解出服务端口（无端口 / 解析不了回空串 ⇒ 上面的端口比对不放行）。 */
function serverPortOf(hostHeader: string | null): string {
  if (hostHeader === null || hostHeader === "") {
    return "";
  }
  try {
    return new URL(`http://${hostHeader}`).port;
  } catch {
    return "";
  }
}

/** 本服务端口的取值：优先 Host 头；测试桩 / 个别运行时拿不到 Host 时退回请求
 *  URL 上的端口（两者在真实链路里恒等）。 */
function requestServerPort(request: Request): string {
  const fromHost = serverPortOf(request.headers.get("host"));
  if (fromHost !== "") {
    return fromHost;
  }
  try {
    return new URL(request.url).port;
  } catch {
    return "";
  }
}

/**
 * 端点：GET /api/dev/server-id —— 回 bootId（「真正重启」的权威信号，区分网络抖动与真重启）
 * 与本次启动 runId（launcher 产出，消息中心按「每一次启动」分组；须与 bootId 同一次探测回来，
 * 否则刚恢复时会拿旧 runId 盖错组）。拿不到 runId 给 null（没走 launcher），不编值。
 */
export function GET(request: Request) {
  return NextResponse.json(
    {
      bootId: getServerBootId(),
      runId: getServerRunId(),
    },
    {
      headers: loopbackCorsHeaders(request.headers.get("origin"), requestServerPort(request)),
    },
  );
}
