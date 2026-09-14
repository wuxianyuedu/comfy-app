import { NextResponse } from "next/server";

/**
 * Proxy（Next 16 的 `middleware` 新名字）：本机单用户桌面应用，不做登录墙。
 *
 * - 本应用为本地 ComfyUI 桌面壳，所有 tRPC 过程（authedProcedure）在无会话时
 *   自动回退到 demo 用户（见 src/server/api/trpc.ts），REST 路由由
 *   getServerUser() 兜底，无需登录即可使用全部界面功能。
 * - 原先这里会把 /settings、/workshop 等界面路由在缺少会话 cookie 时重定向到
 *   /login；现已移除该限制，点击左下角「设置」等入口可直接进入，无需登录。
 * - /api/* 不在此拦截：鉴权由 tRPC protected/authed 过程与服务端
 *   getServerUser() / requireServerUser() 在各自路由内处理。
 *
 * 为什么文件叫 proxy 而不是 middleware：Next 16 起 `middleware` 约定名已废弃
 * （构建期固定打一条 deprecation 警告），`proxy.ts` 是它的继任约定，语义等价。
 * 这里刻意**不删这个文件**：删除同样会消掉警告，但会连带丢掉 `config.matcher`
 * 这份「哪些路径将来要走代理」的声明——那是给后来人留的落点（要加鉴权/重写
 * 头/路由分流时改这里，而不是再发明一层）。
 *
 * 文件位置：必须在 `src/` 下与 `app/` 同级。放到 `app/` 里 Next 不会当成 proxy
 * 加载，只会静默失效——构建期不报错，真到要拦请求时才发现「根本没跑」。
 *
 * `sentry.edge.config.ts` 注释里写的「middleware 等 Edge 环境」即指本文件：
 * proxy 是 Edge runtime 的入口（`src/instrumentation.ts` 按 NEXT_RUNTIME 动态引入）。
 */

export function proxy() {
  return NextResponse.next();
}

export const config = {
  // 排除 Next 内部资源与静态文件
  matcher: ["/((?!_next|.*\\..*).*)"],
};
