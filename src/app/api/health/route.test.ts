/**
 * `GET /api/health` 的 schema 就绪度断言（ISSUE #489）。
 *
 * 背景：这个端点此前只做 `SELECT 1`，而**空库上 `SELECT 1` 也成功**——
 * `db.sqlite` 被留成 0 字节（`drizzle-kit push` 在无 TTY 上「报错 + exit 0」，
 * 见 `scripts/db-push.mjs`）时它会照旧回 `db: "up"`。于是「表根本没建」这一档
 * 被探针漏报：`/`、`/api/health` 都 200，只有真实业务路由 500
 * （`SqliteError: no such table: user`）——「看起来通了」比直接失败更难查。
 *
 * 四条契约：
 *   ready    → 200 + `db: "up"`（不能因为加了判据就把正常态也判坏）；
 *   missing  → 503 + `db: "empty"`（表还没建，探针必须说得出「为什么」）；
 *   unknown  → 503 + `db: "unknown"`（库文件都不在 / 不是 SQLite，同样不许报 ok）；
 *   探活失败 → 503 + `db: "down"`（前提是真去 await 那条 promise，见对应用例）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const probeSchemaSync = vi.fn<() => "ready" | "missing" | "unknown">();

vi.mock("~/lib/db-schema-ready", () => ({
  probeSchemaSync: (): "ready" | "missing" | "unknown" => probeSchemaSync(),
}));

// 路由不再直连 db/orm（§1.10），改调 `pingDatabase`；mock 需一并给出该出口，
// 否则 call `undefined` 会落进 catch 而把所有用例都判成 503。
// 出口给的是 Promise（异步驱动），所以替身也照 Promise 形状来：既能 mock 成功，
// 也能 mock 成 rejection —— 后者正是「路由有没有 await」这件事唯一看得见的地方。
const pingDatabase = vi.fn<() => Promise<unknown>>(async () => undefined);

vi.mock("~/server/db", () => ({
  db: { run: vi.fn() },
  pingDatabase: (): Promise<unknown> => pingDatabase(),
}));

vi.mock("~/lib/core/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

beforeEach(() => {
  probeSchemaSync.mockReset();
  pingDatabase.mockReset();
  pingDatabase.mockResolvedValue(undefined);
});

describe("GET /api/health", () => {
  it("表就绪时返回 200 + db: up", async () => {
    probeSchemaSync.mockReturnValue("ready");
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({ status: "ok", db: "up" }),
    );
  });

  it("表还没建时返回 503 + db: empty（旧实现此处回 db: up，漏报整档）", async () => {
    probeSchemaSync.mockReturnValue("missing");
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      status: string;
      db: string;
      hint: string;
    };
    expect(body.db).toBe("empty");
    expect(body.status).toBe("error");
    // 失败路径必须有可行动出口（规范 §9.2 第 3 条），不能只报「错了」。
    expect(body.hint).toContain("db:push");
  });

  it("库文件缺失 / 不是 SQLite 时返回 503 + db: unknown", async () => {
    probeSchemaSync.mockReturnValue("unknown");
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({ status: "error", db: "unknown" }),
    );
  });

  it("探活本身失败 → 503 + db: down（少一个 await 这里就是假 200）", async () => {
    // 换成异步驱动之后 `SELECT 1` 是**promise**：路由不 await 它就必然回
    // `db: up`，reject 变成一个游离的 unhandled rejection —— 外部探针
    // （UptimeRobot / Grafana / 容器健康检查）对端点的全部信任就在这里。
    // 反向验证：把路由的 `await` 去掉，本条即红（回 200）。
    probeSchemaSync.mockReturnValue("ready");
    pingDatabase.mockRejectedValueOnce(
      new Error("SQLITE_CANTOPEN: unable to open"),
    );
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({ status: "error", db: "down" }),
    );
  });
});
