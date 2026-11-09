/**
 * 除以下两种情况外一般不需要改：① 改请求上下文（「1. 上下文」）；② 新增中间件或某类 procedure（「3.」）。
 * 所有 tRPC 服务端部件都在这里创建并接线，各部件说明见文件末尾。
 */

import "server-only";

import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";

import { auth } from "~/server/better-auth";
import { db } from "~/server/db";
import { requireServerUser } from "~/lib/auth-server";
import { userRepository } from "~/lib/core/repository";
import { checkRateLimit } from "~/server/api/middleware/rate-limit";
import { logger } from "~/server/lib/logger";
import { createAppRuntimeLogger } from "~/lib/log/app-runtime-log";

const trpcRuntimeLog = createAppRuntimeLogger("trpc");

export type TRPCUser = {
  email: string;
  id: string;
  name: string | null;
};

/**
 * 1. CONTEXT
 *
 * 从 better-auth 会话解析当前用户；本地单用户模式的「演示用户兜底」由 `authedProcedure` 处理。
 */
export const createTRPCContext = async (opts: { headers: Headers }) => {
  const session = await auth.api.getSession({
    headers: opts.headers,
  });

  let user: TRPCUser | null = null;
  if (session?.user?.email !== undefined && session.user.email !== "") {
    let dbUser = await userRepository.findByEmail(session.user.email);
    dbUser ??= await userRepository.createUser({
      email: session.user.email,
      name: session.user.name,
      password: "oauth-not-used",
    });
    user = { id: dbUser.id, email: dbUser.email, name: dbUser.name ?? null };
  }

  return {
    db,
    session,
    user,
    ...opts,
  };
};

/**
 * 2. INITIALIZATION
 */
const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error, path }) {
    // 生产级可观测性：所有 tRPC 错误落结构化日志
    if (error.code !== "UNAUTHORIZED" && error.code !== "FORBIDDEN") {
      logger.warn(
        { code: error.code, path, name: error.name, message: error.message },
        "trpc_error",
      );
    }
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const createCallerFactory = t.createCallerFactory;
export const createTRPCRouter = t.router;

/**
 * procedure 计时中间件：仅失败或超阈值才写面板可见日志，成功只走 pino `logger.debug`（否则面板会被
 * 每条 query/mutation 刷成噪音）。慢查询按「路径 + 时间桶」聚合（ISSUE #346）：同桶只写首条、其余计数，
 * 桶满写 `×N` 汇总 —— 把「持续慢」从 N 条压成 2 条（首次时刻 + 次数；规范 07 §7.13 唯一面板出口）。
 */
const SLOW_QUERY_THRESHOLD_MS = 1000;

/** 聚合窗口：同一 (路径, 类型) 在窗口内的后续慢查询只累加计数，不重复写行。 */
const SLOW_LOG_COALESCE_MS = 60_000;

type SlowBucket = { at: number; count: number };

/* 聚合窗口挂在 globalThis（HMR 重载后仍连续）：经环境声明拿 typed 键，不再断言。 */
declare global {
  var __trpcSlowQueryBuckets_v1: Map<string, SlowBucket> | undefined;
}

const buckets = (() => {
  globalThis.__trpcSlowQueryBuckets_v1 ??= new Map<string, SlowBucket>();
  return globalThis.__trpcSlowQueryBuckets_v1;
})();

/** 记录一次慢查询；返回需要在面板写的行（不写时返回 null）。 */
export function recordSlowQuery(
  path: string,
  durationMs: number,
  type: string,
  nowMs: number = Date.now(),
): string | null {
  const key = `${type}:${path}`;
  const bucket = buckets.get(key);
  if (bucket && nowMs - bucket.at < SLOW_LOG_COALESCE_MS) {
    bucket.count += 1;
    return null;
  }
  const text =
    bucket && bucket.count > 1
      ? `${path} ${durationMs}ms（近 ${Math.round(SLOW_LOG_COALESCE_MS / 1000)}s 内共 ${bucket.count} 次）`
      : `${path} ${durationMs}ms`;
  buckets.set(key, { at: nowMs, count: 1 });
  return text;
}

/** 测试辅助：清空慢查询聚合桶（跨用例共享 globalThis，必须显式重置）。 */
export function resetSlowQueryBuckets(): void {
  buckets.clear();
}

const timingMiddleware = t.middleware(async ({ next, path, type }) => {
  const start = Date.now();
  // 本地单机应用（Tauri 壳 ↔ loopback server），不注入任何人为延迟：
  // create-t3-app 脚手架的「模拟网络延迟」在此毫无意义，却会让每个
  // procedure 无端 0.1–0.5s，dev 期整体明显偏慢。这里只保留耗时观测。
  try {
    const result = await next();
    const durationMs = Date.now() - start;
    logger.debug({ path, durationMs, type }, "trpc_timing");
    // 仅当调用明显变慢（预期外的慢）才在面板给一条 warn，正常调用不打扰用户。
    if (durationMs >= SLOW_QUERY_THRESHOLD_MS) {
      const text = recordSlowQuery(path, durationMs, type);
      if (text !== null) {
        trpcRuntimeLog.warn(text, { type });
      }
    }
    return result;
  } catch (error) {
    const durationMs = Date.now() - start;
    logger.debug({ path, durationMs, type }, "trpc_timing");
    // 调用抛错 = 出问题：在面板可见通道记一条 error，便于用户当场定位。
    trpcRuntimeLog.error(`${path} 失败 ${durationMs}ms`, {
      type,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
});

/**
 * 公开（不需登录）的 procedure —— ctx.user 可能为 null。
 */
export const publicProcedure = t.procedure.use(timingMiddleware);

/**
 * 需登录（带演示用户兜底）的 procedure，保证 ctx.user 非 null；放行由 `~/lib/auth-server` 的 `requireServerUser`
 * 一处判决（`loginRequired` 为唯一开关）：false → 回落演示用户（本机单用户，与 REST 一致）；true → UNAUTHORIZED。
 * 旧实现自带「无条件兜底 + 缓存 demo 用户」，令开关在 tRPC 面形同虚设、并复刻了缓存越过数据库的缺陷。
 */
export const authedProcedure = t.procedure.use(timingMiddleware).use(async ({ ctx, next }) => {
  const user = ctx.user ?? (await requireServerUser(ctx.session));
  if (!user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "需要登录后才能执行该操作",
    });
  }
  return next({ ctx: { ...ctx, user } });
});

/**
 * 带限流的「需登录」procedure：对敏感操作（提权、删除、导出等）按 userId 做滑动窗口限流，防脚本暴力调用；
 * 默认 10 秒窗口内 20 次，超限返回 429。
 */
export const rateLimitedProcedure = authedProcedure.use(async ({ ctx, next }) => {
  // authedProcedure 已保证 ctx.user 非空（类型上也是），userId 是限流的唯一键。
  const key = ctx.user.id;
  if (!checkRateLimit(key)) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "请求过于频繁，请稍后再试",
    });
  }
  return next({ ctx });
});
