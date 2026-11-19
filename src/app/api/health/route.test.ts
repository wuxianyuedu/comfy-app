/**
 * `GET /api/health` 的 schema 就绪度断言（ISSUE #489）：此前只做 `SELECT 1`，而空库上它也成功，`db.sqlite` 留成 0 字节时照旧回
 * `db: "up"` —— 「表根本没建」被漏报成 200，只有业务路由 500（`no such table: user`）。四条契约：ready→200 `db:"up"`、
 * missing→503 `db:"empty"`、unknown→503 `db:"unknown"`、探活失败→503 `db:"down"`（前提是真 await 那条 promise）；另有 D5：CORS 从 `*` 收窄成启动页那一族源、响应体不再出现内部文档路径。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { isRecord } from "~/lib/is-record";

const probeSchemaSync = vi.fn<() => "ready" | "missing" | "unknown">();

vi.mock("~/lib/db-schema-ready", () => ({
  probeSchemaSync: (): "ready" | "missing" | "unknown" => probeSchemaSync(),
}));

// 路由不再直连 db/orm（§1.10），改调 `pingDatabase`；mock 需一并给出该出口，
// 否则 call `undefined` 会落进 catch 而把所有用例都判成 503。
// 出口给的是 Promise（异步驱动），所以替身也照 Promise 形状来：既能 mock 成功，
// 也能 mock 成 rejection —— 后者正是「路由有没有 await」这件事唯一看得见的地方。
const pingDatabase = vi.fn<() => Promise<unknown>>(() => Promise.resolve(undefined));

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
    const res = await GET(new Request("http://127.0.0.1:3000/api/health"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(expect.objectContaining({ status: "ok", db: "up" }));
  });

  it("表还没建时返回 503 + db: empty（旧实现此处回 db: up，漏报整档）", async () => {
    probeSchemaSync.mockReturnValue("missing");
    const { GET } = await import("./route");
    const res = await GET(new Request("http://127.0.0.1:3000/api/health"));
    expect(res.status).toBe(503);
    const raw: unknown = await res.json();
    if (!isRecord(raw) || typeof raw.hint !== "string") {
      throw new Error("响应体缺少 hint");
    }
    expect(raw.db).toBe("empty");
    expect(raw.status).toBe("error");
    // 失败路径必须有可行动出口（规范 §9.2 第 3 条），不能只报「错了」。
    expect(raw.hint).toContain("db:push");
  });

  it("库文件缺失 / 不是 SQLite 时返回 503 + db: unknown", async () => {
    probeSchemaSync.mockReturnValue("unknown");
    const { GET } = await import("./route");
    const res = await GET(new Request("http://127.0.0.1:3000/api/health"));
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
    pingDatabase.mockRejectedValueOnce(new Error("SQLITE_CANTOPEN: unable to open"));
    const { GET } = await import("./route");
    const res = await GET(new Request("http://127.0.0.1:3000/api/health"));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({ status: "error", db: "down" }),
    );
  });
});

/* ── 跨域面：白名单收窄 + 响应体不许出现内部路径（D5）──────────────
 * 启动页与 dev server 不同源，且必须走 `mode: "cors"` 才读得到真实状态码（no-cors 的 opaque 读不到，正是历史「过早导航」的根因）。
 * 此前白名单是 `*`，而 503 响应体带一句含内部文档路径的运维提示 —— 收窄后恶意网页一读就被同源策略拒掉，启动页仍照常。
 */
describe("GET /api/health 跨域面（D5）", () => {
  const url = "http://127.0.0.1:3000/api/health";

  it("启动页那三个源都在白名单里（分平台，不分叉）", async () => {
    probeSchemaSync.mockReturnValue("ready");
    const { GET } = await import("./route");
    for (const origin of [
      "tauri://localhost",
      "http://tauri.localhost",
      "https://tauri.localhost",
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- 用例逐轮 await 以保持断言顺序与桩状态
      const res = await GET(new Request(url, { headers: { origin } }));
      expect(res.headers.get("access-control-allow-origin"), origin).toBe(origin);
      /* 回显源 + `Vary` 两件都要：只给前者时，链路上的缓存会把第一个访问者的头
       * 复用给所有源（白名单形同虚设，且是静默的）。 */
      expect(res.headers.get("vary"), origin).toBe("Origin");
    }
  });

  it("别的源**一个 CORS 头都不给**（回别的值等于放行）", async () => {
    probeSchemaSync.mockReturnValue("ready");
    const { GET } = await import("./route");
    for (const origin of ["https://evil.example", "null"]) {
      // oxlint-disable-next-line no-await-in-loop -- 用例逐轮 await 以保持断言顺序与桩状态
      const res = await GET(new Request(url, { headers: { origin } }));
      expect(res.headers.get("access-control-allow-origin"), origin).toBeNull();
    }
  });

  it("没带 Origin（Node 探针 / 容器健康检查）照常 200，且不回 CORS 头", async () => {
    /* 外部探针（UptimeRobot / Grafana / 容器健康检查）是**服务端**发的请求，
     * 没有同源策略、也不需要这个头 —— 判据是「收窄不能把它们一起收掉」。 */
    probeSchemaSync.mockReturnValue("ready");
    const { GET } = await import("./route");
    const res = await GET(new Request(url));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("503 的 hint 不含内部文档路径（响应体不给仓库文档当出口）", async () => {
    probeSchemaSync.mockReturnValue("missing");
    const { GET } = await import("./route");
    const raw: unknown = await (await GET(new Request(url))).json();
    if (!isRecord(raw) || typeof raw.hint !== "string") {
      throw new Error("响应体缺少 hint");
    }
    expect(raw.hint).not.toContain("docs/");
    expect(raw.hint).not.toContain("standards/");
    /* 但「先说自己会好」那一层要在：桌包首启是常规形态，用户此刻什么都不必做。 */
    expect(raw.hint).toContain("自动建表");
  });
});
