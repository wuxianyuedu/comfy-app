/**
 * auth/会话边界 + authedProcedure demo 兜底与 loginRequired 开关 + rateLimitedProcedure 限流契约测试（Issue #11）。
 *
 * 覆盖：
 * - createTRPCContext 的会话边界（未登录 → user null / 已有用户 → 取库中 / 新邮箱 → 自动建号）。
 * - authedProcedure 的 demo-user 兜底（ctx.user 为 null 时注入 demo@comfy.app）。
 * - authedProcedure 与 REST 面共用的 `loginRequired` 判决：开关打开且无会话
 *   → UNAUTHORIZED；已登录照常放行（此前 tRPC 面无条件兜底，开关形同虚设）。
 * - rateLimitedProcedure 超窗返回 TOO_MANY_REQUESTS、不同 key 相互独立。
 *
 * mock 边界：~/server/db（内存测试库）、~/server/better-auth（可控 getSession）、
 * ~/lib/core/logger（静音）、~/lib/app-settings/app-settings.server（可控
 * loginRequired 开关，同 auth-server.test.ts 的口径）。鉴权/限流中间件均走真实实现。
 *
 * 说明：限流「超窗测试」先用同一模块的 `checkRateLimit` 预填桶（二者共享限流桶），
 * 以最少真实 tRPC 调用确定性地命中「超窗 → TOO_MANY_REQUESTS」路径。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type * as AppSettingsModule from "~/lib/app-settings/app-settings.server";

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
/* loginRequired 开关可控（真实实现要读 data/app-settings.json），
 * 其余设置走真实导出。 */
let loginRequired = false;
vi.mock("~/lib/app-settings/app-settings.server", async (importOriginal) => {
  const mod = await importOriginal<typeof AppSettingsModule>();
  return {
    ...mod,
    getSettingsSync: () => ({ ...mod.getSettingsSync(), loginRequired }),
  };
});
/* 静音服务端日志。
 *
 * 用 `importOriginal` 部分 mock：日志实现只有一份（`lib/core/logger`），
 * 整模块 mock 掉会让 ERROR 镜像等真实导出在 import 期就炸，因此这里必须
 * 保留真实导出，只替换 `logger` 实例。 */
vi.mock("~/lib/core/logger", async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();
  return {
    ...actual,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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
  loginRequired = false;
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
    expect(
      tdb.$tables.users.filter((u: Row) => u.email === "has@test.dev"),
    ).toHaveLength(1);
  });

  it("会话邮箱不存在 → 自动建号并注入 ctx.user", async () => {
    getSessionMock.mockResolvedValue({
      user: { email: "new@test.dev", name: "新用户" },
    });
    const ctx = await createTRPCContext({ headers: new Headers() });
    expect(ctx.user?.email).toBe("new@test.dev");
    expect(
      tdb.$tables.users.find((u: Row) => u.email === "new@test.dev"),
    ).toBeDefined();
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

  it("loginRequired=true 且无会话 → UNAUTHORIZED（开关不再被 tRPC 面绕过）", async () => {
    loginRequired = true;
    const caller = createCaller(makeCtx({ user: null }));
    await expect(caller.authedWhoami()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    // 开关拦下时不得顺手建出演示用户（与 REST 面同一要求）
    expect(
      tdb.$tables.users.find((u: Row) => u.email === "demo@comfy.app"),
    ).toBeUndefined();
  });

  it("loginRequired=true 但 ctx.user 已有真实用户 → 照常放行", async () => {
    loginRequired = true;
    const caller = createCaller(makeCtx());
    const res = await caller.authedWhoami();
    expect(res.user?.id).toBe("user-a");
  });
});

// ─────────────────────────── rateLimitedProcedure 限流分支 ───────────────────────────

describe("rateLimitedProcedure 限流分支", () => {
  it("同一 key 超窗后抛 TOO_MANY_REQUESTS", async () => {
    // 与 rateLimitedProcedure 共享同一限流桶：直接预填满默认窗口（max 20）。
    for (let i = 0; i < 20; i++) expect(checkRateLimit("rl-u")).toBe(true);
    // 第 21 次经真实中间件 → 被拒
    const caller = createCaller(
      makeCtx({ user: { id: "rl-u", email: "rl@test.dev", name: "R" } }),
    );
    await expect(caller.sensitive()).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
  });

  it("窗口未超时放行；不同 userId 独立计数互不影响", async () => {
    // 给 key rl-a 灌满，rl-b 保持干净
    for (let i = 0; i < 20; i++) checkRateLimit("rl-a");
    const callerA = createCaller(
      makeCtx({ user: { id: "rl-a", email: "a@t.dev", name: "A" } }),
    );
    const callerB = createCaller(
      makeCtx({ user: { id: "rl-b", email: "b@t.dev", name: "B" } }),
    );
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
    const first = recordSlowQuery(
      "setting.comfyStatus",
      10_457,
      "query",
      1_000,
    );
    expect(first).toBe("setting.comfyStatus 10457ms");
    for (let i = 0; i < 9; i++) {
      expect(
        recordSlowQuery("setting.comfyStatus", 10_500, "query", 1_000 + i),
      ).toBe(null);
    }
  });

  it("窗口过期后写一条带累计次数的汇总行，并开启新窗口", () => {
    recordSlowQuery("setting.comfyStatus", 10_457, "query", 1_000);
    recordSlowQuery("setting.comfyStatus", 10_457, "query", 2_000);
    recordSlowQuery("setting.comfyStatus", 10_457, "query", 3_000);
    const summary = recordSlowQuery(
      "setting.comfyStatus",
      11_000,
      "query",
      200_000,
    );
    expect(summary).toBe("setting.comfyStatus 11000ms（近 60s 内共 3 次）");
  });

  it("不同路径 / 不同类型的窗口互相独立", () => {
    expect(recordSlowQuery("a.b", 2_000, "query", 1_000)).not.toBeNull();
    expect(recordSlowQuery("a.c", 2_000, "query", 1_000)).not.toBeNull();
    expect(recordSlowQuery("a.b", 2_000, "mutation", 1_000)).not.toBeNull();
  });
});
