/**
 * 除非属于下面两种情况，你大概不需要改这个文件：
 * 1. 想改请求上下文（见「1. 上下文」一节）。
 * 2. 想新增中间件或某一类 procedure（见「3. procedure 类型」一节）。
 *
 * 一句话说明：所有 tRPC 服务端的东西都在这里创建并接线；
 * 你需要的各个部件在文件末尾都有对应的说明。
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

export interface TRPCUser {
  id: string;
  email: string;
  name: string | null;
}

/**
 * 1. CONTEXT
 *
 * 从 better-auth 的会话里解析当前用户（有会话的话）。
 * 本地单用户模式的「演示用户兜底」由 `authedProcedure` 中间件处理 ——
 * 上下文本身只解析真实会话。
 */
export const createTRPCContext = async (opts: { headers: Headers }) => {
  const session = await auth.api.getSession({
    headers: opts.headers,
  });

  let user: TRPCUser | null = null;
  if (session?.user?.email) {
    let dbUser = await userRepository.findByEmail(session.user.email);
    dbUser ??= await userRepository.createUser({
      email: session.user.email,
      name: session.user.name ?? null,
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
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const createCallerFactory = t.createCallerFactory;
export const createTRPCRouter = t.router;

/**
 * 给 procedure 执行计时的中间件。
 *
 * 面板可见日志只在「出问题」时才写：调用失败或耗时超过阈值视为问题。
 * 正常成功的调用仅走 pino `logger.debug`（落在 nextjs 文件日志，方便诊断），
 * 不写入面板可见的 app-runtime 通道，避免每条 query/mutation 都在面板累积成几千条噪音。
 *
 * ── 慢查询按「路径 + 时间桶」聚合（ISSUE #346）────────────────────────
 * 慢查询 warn 本身是必要的出口（「有问题的 query」唯一的面板出口，见规范 07
 * §7.13），但同一个查询在每一轮轮询里都慢时，每次都会写一条**内容完全相同**的
 * 行：面板上只剩满屏 `setting.comfyStatus 10457ms`，不仅刷屏，还把真正新增的
 * 业务日志挤出视野，用户读到的信息量是零。
 *
 * 同一路径在同一时间桶内只写**首条**，其余累计条数；桶满后写一条带 `×N` 的
 * 汇总行。这样「持续慢」从 N 条噪音压缩成 2 条可读记录：一条首次发生的时刻 +
 * 一条「发生了多少次」。
 */
const SLOW_QUERY_THRESHOLD_MS = 1000;

/** 聚合窗口：同一 (路径, 类型) 在窗口内的后续慢查询只累加计数，不重复写行。 */
const SLOW_LOG_COALESCE_MS = 60_000;

type SlowBucket = { at: number; count: number };

const G_KEY = "__trpcSlowQueryBuckets_v1";
const buckets = (() => {
  const g = globalThis as unknown as Record<
    string,
    Map<string, SlowBucket> | undefined
  >;
  g[G_KEY] ??= new Map<string, SlowBucket>();
  return g[G_KEY];
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
      if (text) trpcRuntimeLog.warn(text, { type });
    }
    return result;
  } catch (cause) {
    const durationMs = Date.now() - start;
    logger.debug({ path, durationMs, type }, "trpc_timing");
    // 调用抛错 = 出问题：在面板可见通道记一条 error，便于用户当场定位。
    trpcRuntimeLog.error(`${path} 失败 ${durationMs}ms`, {
      type,
      error: cause instanceof Error ? cause.message : String(cause),
    });
    throw cause;
  }
});

/**
 * 公开（不需登录）的 procedure —— ctx.user 可能为 null。
 */
export const publicProcedure = t.procedure.use(timingMiddleware);

/**
 * 需要登录（并带演示用户兜底）的 procedure。
 *
 * 保证 ctx.user 不为 null。无会话时的放行与否由 `~/lib/auth-server` 的
 * `requireServerUser` 一处判决（`app-settings.json` 的 `loginRequired`
 * 是唯一开关）：
 *   - false（默认，本机单用户模式）→ 回落演示用户，与 REST 面一致；
 *   - true → 无会话抛 UNAUTHORIZED，**不再**无条件兜底。
 *
 * 此前这里自带一份「无条件兜底 + 整体缓存 demo 用户」的实现，既让
 * `loginRequired` 开关在 tRPC 面形同虚设（REST 面拦、tRPC 面放——约 200 个
 * procedure 匿名可用），也复刻了 `auth-server.ts` 点名修掉的「缓存越过
 * 数据库」缺陷（库行被重建/删除后仍返回不存在的 id）。收口到同一判决后，
 * 两个 API 面的鉴权语义由 `requireServerUser` 单点持有。
 */
export const authedProcedure = t.procedure
  .use(timingMiddleware)
  .use(async ({ ctx, next }) => {
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
 * 带限流的「需登录」procedure。
 *
 * 对敏感操作（提权、删除、导出等）按 userId/IP 做滑动窗口限流，
 * 防脚本暴力调用。默认 10 秒窗口内 20 次，超限返回 429。
 */
export const rateLimitedProcedure = authedProcedure.use(
  async ({ ctx, next }) => {
    const key = ctx.user.id ?? ctx.headers.get("x-forwarded-for") ?? "anon";
    if (!checkRateLimit(key)) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "请求过于频繁，请稍后再试",
      });
    }
    return next({ ctx });
  },
);
