/**
 * `lib/auth-server` 的「会话 → 用户」判决面（ISSUE #565）。
 *
 * 这组用例此前**写不出来**：模块自己 `import { getSession } from "~/server/better-auth/server"`，
 * 而 `getSession` 内部是 `await headers()` —— 脱离 Next 请求上下文就抛
 * ``headers` was called outside a request scope`。所以那条 `lib → server` 越界边
 * 的代价不只是「分层不干净」，而是**这里的判决逻辑一直无法被观察到**。
 *
 * 会话改为入参之后，这里可以直接喂各种会话形状；`getSession` 的读取落在
 * `src/server/auth/request-user.ts`（`src/server/**` 本来就是服务端物）。
 *
 * mock 边界：`~/server/db`（内存真库）、`~/lib/app-settings/app-settings.server`
 * （`loginRequired` 开关，真实实现要读 `data/app-settings.json`）。判决逻辑走真实实现。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as AppSettingsModule from "~/lib/app-settings/app-settings.server";

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../tests/helpers/test-db");
  return { db: createTestDb() };
});

let loginRequired = false;
vi.mock("~/lib/app-settings/app-settings.server", async (importOriginal) => {
  const mod = await importOriginal<typeof AppSettingsModule>();
  return {
    ...mod,
    getSettingsSync: () => ({ ...mod.getSettingsSync(), loginRequired }),
  };
});

import { getServerUser, requireServerUser } from "~/lib/auth-server";
import { getTestDb, seedUser } from "../../tests/helpers/test-db";

const tdb = getTestDb();
const DEMO_EMAIL = process.env.DEMO_USER_EMAIL ?? "demo@comfy.app";

beforeEach(() => {
  tdb.$reset();
  loginRequired = false;
});

describe("getServerUser：已登录取真实用户，未登录回落演示用户", () => {
  it("会话命中已有用户 → 取库中用户，不重复建号", async () => {
    seedUser(tdb, { id: "u-exist", email: "has@test.dev", name: "已有" });
    const user = await getServerUser({
      user: { email: "has@test.dev", name: "已有" },
    });
    expect(user).toEqual({
      id: "u-exist",
      email: "has@test.dev",
      name: "已有",
    });
    expect(tdb.$tables.users).toHaveLength(1);
  });

  it("会话邮箱在库里没有 → 自动建号（OAuth 首次登录）", async () => {
    const user = await getServerUser({
      user: { email: "new@test.dev", name: "新来的" },
    });
    expect(user.email).toBe("new@test.dev");
    expect(user.name).toBe("新来的");
    expect(tdb.$tables.users.map((u) => u.email)).toEqual(["new@test.dev"]);
  });

  it("会话没有 name → 落库为 null，不是空串", async () => {
    const user = await getServerUser({ user: { email: "anon@test.dev" } });
    expect(user.name).toBeNull();
    expect(tdb.$tables.users[0]?.name).toBeNull();
  });

  it("无会话 → 回落演示用户（email 确定性，name 为「体验用户」）", async () => {
    const user = await getServerUser(null);
    expect(user.email).toBe(DEMO_EMAIL);
    expect(user.name).toBe("体验用户");
  });

  it("会话为 null 与「会话里没有 user」等价：都回落演示用户", async () => {
    const a = await getServerUser(null);
    const b = await getServerUser({});
    expect(b).toEqual(a);
  });

  it("重复调用只建一行（email 确定性 → 同一 id，不会反复建号）", async () => {
    const a = await getServerUser(null);
    const b = await getServerUser(null);
    expect(b).toEqual(a);
    expect(
      tdb.$tables.users.filter((u) => u.email === DEMO_EMAIL),
    ).toHaveLength(1);
  });

  /* 下面这条钉住的是「缓存不许越过数据库」这个判决（不是缓存本身）。
   *
   * 曾经的实现把**解析结果**记在模块级变量里，于是缓存一旦填上，后续调用
   * 完全绕过 `findByEmail`。而 `user` 表会被重建（`drizzle-kit push` 的
   * `__new_X` 重建流程，见 `scripts/heal-db.cjs`），那时缓存里的 id 在库里
   * 已经不存在 —— 返回它会让下游每一处按 userId 的写入失败或留下孤儿行，
   * 报错还指向写入语句而不是「用户是虚构的」。
   *
   * 现在 memo 的只是 email，实体每行都查库，所以这条不成立。 */
  it("用户行消失后不再返回旧 id（缓存不得越过数据库）", async () => {
    const first = await getServerUser(null);
    tdb.$reset(); // 模拟用户表被重建 / 该行被删
    const after = await getServerUser(null);

    // 关键：返回的 id 必须真的在库里存在（而不是「和上次一样」）
    const rows = tdb.$tables.users;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(after.id);
    // 旧 id 已随行一起消失，不能「复用」到新行上
    expect(first.id).not.toBe(after.id);
  });

  it("邮箱为空串视为未登录（不能拿空 email 去建号）", async () => {
    const user = await getServerUser({ user: { email: "" } });
    expect(user.email).toBe(DEMO_EMAIL);
    expect(tdb.$tables.users.map((u) => u.email)).toEqual([DEMO_EMAIL]);
  });
});

describe("requireServerUser：loginRequired 是唯一开关", () => {
  it("loginRequired=false（本机单用户）→ 无会话也回落演示用户", async () => {
    const user = await requireServerUser(null);
    expect(user?.email).toBe(DEMO_EMAIL);
  });

  it("loginRequired=true → 无会话返回 null（调用方 401）", async () => {
    loginRequired = true;
    expect(await requireServerUser(null)).toBeNull();
  });

  it("loginRequired=true 但已登录 → 照常放行", async () => {
    loginRequired = true;
    seedUser(tdb, { id: "u-1", email: "in@test.dev", name: "登录的" });
    const user = await requireServerUser({ user: { email: "in@test.dev" } });
    expect(user?.id).toBe("u-1");
  });

  it("loginRequired=true 且无会话时不建演示用户（不能留下无用行）", async () => {
    loginRequired = true;
    await requireServerUser(null);
    expect(tdb.$tables.users).toHaveLength(0);
  });
});
