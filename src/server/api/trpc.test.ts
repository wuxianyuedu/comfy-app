/** auth/会话边界＋authedProcedure demo 兜底＋rateLimitedProcedure 限流契约（Issue #11 / ISSUE #3827）。
 * 登录页与登录开关已移除：无会话一律回落演示用户，不再因 `loginRequired` 拒绝；mock 只到 db /
 * better-auth / logger，鉴权与限流中间件走真实实现；超窗用同模块 `checkRateLimit` 预填共享桶，
 * 以最少真实调用确定性命中 TOO_MANY_REQUESTS。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { getSessionMock, loggerMocks } = vi.hoisted(() => {
  /* 带签名的 mock：mock.calls 的元素是 [fields, msg]，测试里解构不落 any。 */
  const logFn = () => vi.fn<(fields: Record<string, unknown>, msg: string) => void>();
  return {
    getSessionMock: vi.fn<() => Promise<unknown>>(() => Promise.resolve(null)),
    loggerMocks: { debug: logFn(), info: logFn(), warn: logFn(), error: logFn() },
  };
});

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../tests/helpers/test-db");
  return { db: createTestDb() };
});
vi.mock("~/server/better-auth", () => ({
  auth: { api: { getSession: getSessionMock } },
}));
/* 静音服务端日志。
 *
 * 用 `importOriginal` 部分 mock：日志实现只有一份（`lib/core/logger`），
 * 整模块 mock 掉会让 ERROR 镜像等真实导出在 import 期就炸，因此这里必须
 * 保留真实导出，只替换 `logger` 实例。 */
vi.mock("~/lib/core/logger", async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();
  return {
    ...actual,
    logger: loggerMocks,
  };
});

import {
  createCallerFactory,
  createTRPCContext,
  createTRPCRouter,
  publicProcedure,
  authedProcedure,
  rateLimitedProcedure,
  recordSlowQuery,
  resetSlowQueryBuckets,
  logTrpcError,
} from "~/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { checkRateLimit } from "~/server/api/middleware/rate-limit";
import { getTestDb, seedUser, type Row } from "../../../tests/helpers/test-db";
import { makeCtx } from "../../../tests/helpers/trpc";

const createCaller = createCallerFactory(
  createTRPCRouter({
    whoami: publicProcedure.query(({ ctx }) => ({ user: ctx.user })),
    authedWhoami: authedProcedure.query(({ ctx }) => ({ user: ctx.user })),
    sensitive: rateLimitedProcedure.query(({ ctx }) => ({
      ok: true,
      userId: ctx.user.id,
    })),
  }),
);

const tdb = getTestDb();

beforeEach(() => {
  tdb.$reset();
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue(null);
});

// ─────────────────────────── createTRPCContext 会话边界 ───────────────────────────

describe("createTRPCContext 会话注入边界", () => {
  it("better-auth 未登录（无会话）→ ctx.user 为 null", async () => {
    getSessionMock.mockResolvedValue(null);
    const ctx = await createTRPCContext({ headers: new Headers() });
    expect(ctx.session).toBeNull();
    expect(ctx.user).toBeNull();
  });

  it("会话命中已有用户 → ctx.user 取库中用户，不重复建号", async () => {
    seedUser(tdb, { id: "u-exist", email: "has@test.dev", name: "已有" });
    getSessionMock.mockResolvedValue({
      user: { email: "has@test.dev", name: "已有" },
    });
    const ctx = await createTRPCContext({ headers: new Headers() });
    expect(ctx.user?.id).toBe("u-exist");
    expect(ctx.user?.email).toBe("has@test.dev");
    expect(tdb.$tables.users.filter((u: Row) => u.email === "has@test.dev")).toHaveLength(1);
  });

  it("会话邮箱不存在 → 自动建号并注入 ctx.user", async () => {
    getSessionMock.mockResolvedValue({
      user: { email: "new@test.dev", name: "新用户" },
    });
    const ctx = await createTRPCContext({ headers: new Headers() });
    expect(ctx.user?.email).toBe("new@test.dev");
    expect(tdb.$tables.users.find((u: Row) => u.email === "new@test.dev")).toBeDefined();
  });
});

// ─────────────────────────── authedProcedure demo 兜底 ───────────────────────────

describe("authedProcedure demo-user 兜底", () => {
  it("ctx.user 非空时透传，不注入 demo", async () => {
    const caller = createCaller(makeCtx());
    const res = await caller.authedWhoami();
    expect(res.user.id).toBe("user-a");
  });

  it("ctx.user 为 null（本地单用户/未登录）→ 注入 demo@comfy.app", async () => {
    const caller = createCaller(makeCtx({ user: null }));
    const res = await caller.authedWhoami();
    expect(res.user).not.toBeNull();
    expect(res.user.email).toBe("demo@comfy.app");
  });

  it("无会话始终回落演示用户（无需登录，ISSUE #3827）", async () => {
    const caller = createCaller(makeCtx({ user: null }));
    const res = await caller.authedWhoami();
    expect(res.user.email).toBe("demo@comfy.app");
  });
});

// ─────────────────────────── rateLimitedProcedure 限流分支 ───────────────────────────

describe("rateLimitedProcedure 限流分支", () => {
  it("同一 key 超窗后抛 TOO_MANY_REQUESTS", async () => {
    // 与 rateLimitedProcedure 共享同一限流桶：直接预填满默认窗口（max 20）。
    for (let i = 0; i < 20; i++) {
      expect(checkRateLimit("rl-u")).toBe(true);
    }
    // 第 21 次经真实中间件 → 被拒
    const caller = createCaller(makeCtx({ user: { id: "rl-u", email: "rl@test.dev", name: "R" } }));
    await expect(caller.sensitive()).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
  });

  it("窗口未超时放行；不同 userId 独立计数互不影响", async () => {
    // 给 key rl-a 灌满，rl-b 保持干净
    for (let i = 0; i < 20; i++) {
      checkRateLimit("rl-a");
    }
    const callerA = createCaller(makeCtx({ user: { id: "rl-a", email: "a@t.dev", name: "A" } }));
    const callerB = createCaller(makeCtx({ user: { id: "rl-b", email: "b@t.dev", name: "B" } }));
    await expect(callerA.sensitive()).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    await expect(callerB.sensitive()).resolves.toMatchObject({ ok: true });
  });
});

// ─────────────────────────── 慢查询 warn 的聚合（ISSUE #346）───────────────────────────

describe("recordSlowQuery：同一路径在一个窗口内只写首条 + 一条汇总（#346）", () => {
  beforeEach(() => {
    resetSlowQueryBuckets();
  });

  it("同窗口内重复的慢查询只返回首条，其余不写行（不刷屏）", () => {
    const first = recordSlowQuery("setting.comfyStatus", 10_457, "query", 1000);
    expect(first).toBe("setting.comfyStatus 10457ms");
    for (let i = 0; i < 9; i++) {
      expect(recordSlowQuery("setting.comfyStatus", 10_500, "query", 1000 + i)).toBe(null);
    }
  });

  it("窗口过期后写一条带累计次数的汇总行，并开启新窗口", () => {
    recordSlowQuery("setting.comfyStatus", 10_457, "query", 1000);
    recordSlowQuery("setting.comfyStatus", 10_457, "query", 2000);
    recordSlowQuery("setting.comfyStatus", 10_457, "query", 3000);
    const summary = recordSlowQuery("setting.comfyStatus", 11_000, "query", 200_000);
    expect(summary).toBe("setting.comfyStatus 11000ms（近 60s 内共 3 次）");
  });

  it("不同路径 / 不同类型的窗口互相独立", () => {
    expect(recordSlowQuery("a.b", 2000, "query", 1000)).not.toBeNull();
    expect(recordSlowQuery("a.c", 2000, "query", 1000)).not.toBeNull();
    expect(recordSlowQuery("a.b", 2000, "mutation", 1000)).not.toBeNull();
  });
});

// ─────────────────────────── tRPC 错误日志分级（#4093）───────────────────────────

describe("logTrpcError：服务端故障升 error 带堆栈，客户端错误维持 warn", () => {
  beforeEach(() => {
    loggerMocks.warn.mockClear();
    loggerMocks.error.mockClear();
  });

  it("INTERNAL_SERVER_ERROR → logger.error 并带 stack（真 5xx 不淹在 warn 里、不丢现场）", () => {
    logTrpcError(new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "db down" }), "task.list");
    expect(loggerMocks.error).toHaveBeenCalledTimes(1);
    const [fields, msg] = loggerMocks.error.mock.calls[0] ?? [];
    expect(msg).toBe("trpc_error_server_fault");
    expect(fields).toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      path: "task.list",
      message: "db down",
    });
    expect(typeof fields?.stack).toBe("string");
    expect(loggerMocks.warn).not.toHaveBeenCalled();
  });

  it("BAD_REQUEST → logger.warn（客户端错误不进告警面）", () => {
    logTrpcError(new TRPCError({ code: "BAD_REQUEST", message: "参数坏了" }), "task.create");
    expect(loggerMocks.warn).toHaveBeenCalledTimes(1);
    const [, msg] = loggerMocks.warn.mock.calls[0] ?? [];
    expect(msg).toBe("trpc_error");
    expect(loggerMocks.error).not.toHaveBeenCalled();
  });

  it("UNAUTHORIZED / FORBIDDEN → 预期内的鉴权拒绝，一条都不记", () => {
    logTrpcError(new TRPCError({ code: "UNAUTHORIZED" }));
    logTrpcError(new TRPCError({ code: "FORBIDDEN" }));
    expect(loggerMocks.warn).not.toHaveBeenCalled();
    expect(loggerMocks.error).not.toHaveBeenCalled();
  });
});
