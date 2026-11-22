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
 * ## 「本机同源」看 Host 头，不看 `request.url`（ISSUE #4824）
 *
 * Next 会把 route handler 里 `request.url` 的 host 改写成与请求无关的内部值
 * （实测 dev 下 `127.0.0.1:<port>` 的请求，`request.url` 的 origin 是
 * `localhost:<port>`）——判据挂在它上面，壳页面（源恒为 `http://127.0.0.1:<port>`，
 * 见 shell_launch 的导航 URL）的同源写请求就被自家闸 403（启动水合的尺寸表
 * 保存是第一个触发的现场）。本请求实际打到哪，`Host` 头是唯一事实：浏览器对
 * 同源写请求的 Origin 恒等于页面源，而页面与服务之间没有代理，页面源与 Host
 * 一致；跨站盲发的 Origin 是攻击者自己的源、不可能等于本机 Host —— 判据的
 * 强度不变，换的只是取值处。
 *
 * @returns 放行返回 `null`；跨站返回可直接透传的 403 响应。
 */

/** 本请求自己的源：host 取 `Host` 头（事实），协议取 `request.url` 的协议段
 *  （本服务只有 http 一族）。Host 缺失回 `null` —— 带 Origin 却没有 Host 的
 *  请求是病态形状，调用方按拒绝处置（无从对齐时默认拒绝）。 */
function ownOriginFromHost(request: Pick<Request, "headers" | "url">): string | null {
  const host = request.headers.get("host");
  if (host === null) {
    return null;
  }
  return `${new URL(request.url).protocol}//${host}`;
}

export function rejectCrossOriginWrite(request: Pick<Request, "headers" | "url">): Response | null {
  const origin = request.headers.get("origin");
  if (origin === null) {
    return null;
  }
  const own = ownOriginFromHost(request);
  if (own !== null && origin === own) {
    return null;
  }
  if (isSplashOrigin(origin)) {
    return null;
  }
  return NextResponse.json({ ok: false, error: "跨站请求已拒绝" }, { status: 403 });
}
