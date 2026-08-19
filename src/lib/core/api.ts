/**
 * `api.ts` — 统一 API 路由包装（消除 30 个路由里的重复 try/catch）
 * ===========================================================================
 *
 * 现状
 * ----
 * 44 个 API 路由中 30 个直接依赖 `prisma` 并各自包裹 `try/catch`、手工返回
 * `{ error }` 与状态码。错误形态不统一、缺稳定错误码、易泄露细节。
 *
 * 本模块提供 {@link defineRoute}：一个**高阶路由工厂**，把「拿到已认证用户 →
 * 执行业务 → 返回数据」这段样板收敛为一行，并把任何抛出的异常统一映射为
 * 规范的 HTTP 响应（见 {@link ./errors} 的 `toErrorEnvelope`）。
 *
 * 契约
 * ----
 * - 业务 handler 直接 `throw` 任意 {@link AppError} 子类，框架负责映射状态；
 * - 成功时 handler 的返回值**原样**作为 JSON body 下发（保持 GET 列表返回数组
 *   等既有前端契约不变），无额外信封包裹；
 * - 所有响应都带正确的 `Content-Type: application/json`。
 *
 * 示例
 * ----
 * ```ts
 * export const GET = defineRoute(async ({ user }) => {
 *   return projectRepository.listByUser(user.id);   // 返回 Project[]
 * });
 *
 * export const POST = defineRoute(async ({ req, user }) => {
 *   const body = await parseJsonBody(req);          // 失败自动→400
 *   if (isErr(body)) throw body.error;
 *   return projectRepository.upsertForUser(user.id, body.value as any);
 * });
 * ```
 *
 * @module core/api
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerUser } from "@/lib/auth-server";
import {
  AppError,
  AuthError,
  ValidationError,
  normalizeError,
  toErrorEnvelope,
} from "./errors";
import { isErr, type Result } from "./result";
import { createLogger } from "./logger";

const log = createLogger("core:api");

/** 注入到业务 handler 的运行时上下文。 */
export interface RouteContext {
  /** 原始请求对象（取 body / query / header 用）。 */
  req: NextRequest;
  /** 已认证的当前用户（未登录时框架已在 wrapper 内抛出 {@link AuthError}）。 */
  user: { id: string; email?: string | null };
  /** 动态路由参数（如 `{ projectId: "..." }`）。 */
  params: Record<string, string>;
}

/** 业务 handler 签名：拿到上下文，返回数据或抛出 {@link AppError}。 */
export type RouteHandler = (ctx: RouteContext) => Promise<unknown> | unknown;

/**
 * 路由工厂。把 handler 包装成符合 Next.js App Router 签名的异步函数：
 * `(req, { params }) => Promise<NextResponse>`。
 *
 * 内部统一：认证 → 执行 → 成功返回 / 异常归一化。调用方零样板。
 */
export function defineRoute(handler: RouteHandler) {
  return async function (
    req: NextRequest,
    ctx: { params: Promise<Record<string, string>> }
  ): Promise<NextResponse> {
    try {
      const user = await getServerUser();
      if (!user || !user.id) throw new AuthError();
      // Next.js 15 起动态路由的 params 是 Promise，统一在此 await 后交给 handler。
      const params: Record<string, string> = ctx?.params ? await ctx.params : {};
      const result = await handler({ req, user: user as RouteContext["user"], params });
      return NextResponse.json(result ?? null, { status: 200 });
    } catch (e) {
      const err = normalizeError(e);
      log.error("route failed", {
        code: err.code,
        status: err.httpStatus,
        message: err.message,
      });
      return NextResponse.json(toErrorEnvelope(err), { status: err.httpStatus });
    }
  };
}

/**
 * 安全解析 JSON 请求体：解析失败返回 `Err(ValidationError)`，
 * 不抛出，交由 handler 决定如何中止（或直接 `throw body.error`）。
 */
export async function parseJsonBody(req: NextRequest): Promise<Result<unknown, AppError>> {
  try {
    const text = await req.text();
    if (text.length === 0) return { ok: true, value: undefined } as Result<unknown, AppError>;
    return { ok: true, value: JSON.parse(text) } as Result<unknown, AppError>;
  } catch {
    return { ok: false, error: new ValidationError("请求体不是合法 JSON") } as Result<unknown, AppError>;
  }
}

/** 便捷守卫：解析并断言 body 为非空对象，否则抛出 `ValidationError`。 */
export async function requireJsonBody(req: NextRequest): Promise<Record<string, unknown>> {
  const parsed = await parseJsonBody(req);
  if (!parsed.ok) throw parsed.error;
  const value = parsed.value;
  if (value === null || typeof value !== "object") {
    throw new ValidationError("请求体必须为 JSON 对象");
  }
  return value as Record<string, unknown>;
}
