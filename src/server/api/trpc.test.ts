/**
 * auth/会话边界 + authedProcedure demo 兜底 + rateLimitedProcedure 限流契约测试（Issue #11）。
 *
 * 覆盖：
 * - createTRPCContext 的会话边界（未登录 → user null / 已有用户 → 取库中 / 新邮箱 → 自动建号）。
 * - authedProcedure 的 demo-user 兜底（ctx.user 为 null 时注入 demo@comfy.app）。
 * - rateLimitedProcedure 超窗返回 TOO_MANY_REQUESTS、不同 key 相互独立。
 *
 * mock 边界：~/server/db（内存测试库）、~/server/better-auth（可控 getSession）、
 * ~/server/lib/logger（静音）。鉴权/限流中间件均走真实实现。
 *
 * 说明：tRPC `timingMiddleware` 在非生产为 dev 而加 100–500ms 人工延迟，故超窗测试
 * 先用同一模块的 `checkRateLimit` 预填桶（二者共享限流桶），把真实 tRPC 调用压到最少。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { getSessionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn<() => Promise<unknown>>(async () => null),
}));

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../tests/helpers/test-db");
  return { db: createTestDb() };
});
vi.mock("~/server/better-auth", () => ({
  auth: { api: { getSession: getSessionMock } },
}));
vi.mock("~/server/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  createCallerFactory,
  createTRPCContext,
  createTRPCRouter,
  publicProcedure,
  authedProcedure,
  rateLimitedProcedure,
} from "~/server/api/trpc";
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
    expect(res.user?.id).toBe("user-a");
  });

  it("ctx.user 为 null（本地单用户/未登录）→ 注入 demo@comfy.app", async () => {
    const caller = createCaller(makeCtx({ user: null }));
    const res = await caller.authedWhoami();
    expect(res.user).not.toBeNull();
    expect(res.user?.email).toBe("demo@comfy.app");
  });
});

// ─────────────────────────── rateLimitedProcedure 限流分支 ───────────────────────────

describe("rateLimitedProcedure 限流分支", () => {
  it("同一 key 超窗后抛 TOO_MANY_REQUESTS", async () => {
    // 与 rateLimitedProcedure 共享同一限流桶：直接预填满默认窗口（max 20）。
    for (let i = 0; i < 20; i++) expect(checkRateLimit("rl-u")).toBe(true);
    // 第 21 次经真实中间件 → 被拒
    const caller = createCaller(makeCtx({ user: { id: "rl-u", email: "rl@test.dev", name: "R" } }));
    await expect(caller.sensitive()).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
  });

  it("窗口未超时放行；不同 userId 独立计数互不影响", async () => {
    // 给 key rl-a 灌满，rl-b 保持干净
    for (let i = 0; i < 20; i++) checkRateLimit("rl-a");
    const callerA = createCaller(makeCtx({ user: { id: "rl-a", email: "a@t.dev", name: "A" } }));
    const callerB = createCaller(makeCtx({ user: { id: "rl-b", email: "b@t.dev", name: "B" } }));
    await expect(callerA.sensitive()).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    await expect(callerB.sensitive()).resolves.toMatchObject({ ok: true });
  });
});
