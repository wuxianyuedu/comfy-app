import { NextResponse } from "next/server";

import { isSplashOrigin } from "~/lib/shell/splash-origin";

/**
 * 写副作用端点的同源闸（#4723，#3904 的子项）——全部 POST/PUT/DELETE/PATCH
 * 路由统一走这一份判据（`scripts/gates/check-write-origin-gate.cjs` 强制覆盖）。
 *
 * 为什么鉴权不够：`multipart/form-data` POST 与带查询串的 DELETE 属于 CORS
 * 「简单请求」，不经 preflight，恶意网页可以对本地服务**盲发**写请求——响应虽
 * 不可读，写副作用真实发生（本机单用户模式下 `requireRequestUser()` 恒回落
 * 演示用户放行）。Origin 必须是本机界面同源或启动页那一族（白名单唯一事实源
 * `~/lib/shell/splash-origin`）；缺 Origin（本机工具 / curl）放行——桌面应用的
 * 合法调用方是本机界面与本机工具，而跨站攻击的 fetch 必带 Origin。
 *
 * @returns 放行返回 `null`；跨站返回可直接透传的 403 响应。
 */
export function rejectCrossOriginWrite(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (origin === null) {
    return null;
  }
  if (origin === new URL(request.url).origin) {
    return null;
  }
  if (isSplashOrigin(origin)) {
    return null;
  }
  return NextResponse.json({ ok: false, error: "跨站请求已拒绝" }, { status: 403 });
}
