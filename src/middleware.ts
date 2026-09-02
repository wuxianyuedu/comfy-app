import { NextResponse } from "next/server";

/**
 * Middleware：本机单用户桌面应用，不做登录墙。
 *
 * - 本应用为本地 ComfyUI 桌面壳，所有 tRPC 过程（authedProcedure）在无会话时
 *   自动回退到 demo 用户（见 src/server/api/trpc.ts），REST 路由由
 *   getServerUser() 兜底，无需登录即可使用全部界面功能。
 * - 原先这里会把 /settings、/workshop 等界面路由在缺少会话 cookie 时重定向到
 *   /login；现已移除该限制，点击左下角「设置」等入口可直接进入，无需登录。
 * - /api/* 不在此拦截：鉴权由 tRPC protected/authed 过程与服务端
 *   getServerUser() / requireServerUser() 在各自路由内处理。
 */

export function middleware() {
  return NextResponse.next();
}

export const config = {
  // 排除 Next 内部资源与静态文件
  matcher: ["/((?!_next|.*\\..*).*)"],
};
