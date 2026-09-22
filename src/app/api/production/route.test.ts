/**
 * `PUT /api/production` 的契约（Phase 3b-2）：工坊把生产数据写穿到 production 表。
 *
 * 钉三条：① 未鉴权 → 401；② 缺 project / 缺 production → 400（不静默写空行）；
 * ③ 正常 PUT → 落库一行，JSON 列（shots/progress）原样存回。
 *
 * 走 test-db 内存库（真 Drizzle），只 mock 鉴权与 db 两处边界。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../../tests/helpers/test-db");
  return { db: createTestDb() };
});

const auth = vi.hoisted((): { user: { id: string } | null } => ({
  user: { id: "u1" },
}));
vi.mock("~/server/auth/request-user", () => ({
  requireRequestUser: async () => auth.user,
}));

import { getTestDb, seedUser } from "../../../../tests/helpers/test-db";
import { productionRepository } from "~/lib/core/repository-production";
import { GET, PUT } from "./route";

const tdb = getTestDb();

beforeEach(() => {
  tdb.$reset();
  seedUser(tdb, { id: "u1", email: "u1@test.dev" });
  auth.user = { id: "u1" };
});

function putRequest(body: unknown) {
  return {
    nextUrl: new URL("http://localhost/api/production"),
    json: async () => body,
  } as never;
}

describe("PUT /api/production", () => {
  it("未鉴权 → 401", async () => {
    auth.user = null;
    const res = await PUT(putRequest({ project: "proj_1", production: {} }));
    expect(res.status).toBe(401);
  });

  it("缺 project → 400（不写空行）", async () => {
    const res = await PUT(putRequest({ production: { title: "x" } }));
    expect(res.status).toBe(400);
  });

  it("缺 production → 400", async () => {
    const res = await PUT(putRequest({ project: "proj_1" }));
    expect(res.status).toBe(400);
  });

  it("正常 PUT 落库一行，JSON 列原样存回", async () => {
    const res = await PUT(
      putRequest({
        project: "proj_1",
        production: {
          title: "我的短剧",
          shots: [{ id: "s1", prompt: "p" }],
          progress: { stage: "storyboard", rendered: false },
        },
      }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    const got = await productionRepository.getForUser("u1", "proj_1");
    expect(got?.title).toBe("我的短剧");
    expect(got?.shots).toEqual([{ id: "s1", prompt: "p" }]);
    expect(got?.progress).toEqual({ stage: "storyboard", rendered: false });
  });
});

function getRequest(project: string | null) {
  const url = new URL("http://localhost/api/production");
  if (project) url.searchParams.set("project", project);
  return { nextUrl: url } as never;
}

describe("GET /api/production", () => {
  it("未鉴权 → 401", async () => {
    auth.user = null;
    const res = await GET(getRequest("proj_1"));
    expect(res.status).toBe(401);
  });

  it("缺 project → 400", async () => {
    const res = await GET(getRequest(null));
    expect(res.status).toBe(400);
  });

  it("无该行 → { exists:false }", async () => {
    const res = await GET(getRequest("missing"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ exists: false });
  });

  it("有行 → exists:true 且回传 production（JSON 列已解析）", async () => {
    await productionRepository.upsertForUser("u1", {
      id: "proj_1",
      title: "我的短剧",
      shots: [{ id: "s1" }],
    });
    const res = await GET(getRequest("proj_1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      exists: boolean;
      production: { title: string; shots: unknown };
    };
    expect(body.exists).toBe(true);
    expect(body.production.title).toBe("我的短剧");
    expect(body.production.shots).toEqual([{ id: "s1" }]);
  });
});
