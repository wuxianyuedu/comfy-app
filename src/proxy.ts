import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Proxy：受保护页面的会话守卫（轻量、不触库）。
 *
 * - 只校验会话 cookie 是否存在；真实性由 better-auth 服务端校验。
 * - /api/* 不在此拦截：tRPC 有 protectedProcedure / authedProcedure，
 *   REST route 有 getServerUser()，服务端鉴权更可靠。
 * - 未登录跳转 /login?next=<原路径>，登录后回跳。
 */

const PROTECTED_PREFIXES = [
  "/create",
  "/me",
  "/models",
  "/settings",
  "/train",
  "/workshop",
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api")) return NextResponse.next();

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  // better-auth 的会话 cookie（Node.js runtime 做存在性检查）
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // 排除 Next 内部资源与静态文件
  matcher: ["/((?!_next|.*\\..*).*)"],
};
