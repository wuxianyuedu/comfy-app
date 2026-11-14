/**
 * `PUT /api/production` 契约（Phase 3b-2）：① 未鉴权 → 401；② 缺 project/production → 400
 * （不静默写空行）；③ 正常 PUT → 落库一行，JSON 列（shots/progress）原样存回。
 * 走 test-db 内存库（真 Drizzle），只 mock 鉴权与 db 两处边界。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

import { NextRequest } from "next/server";
import { isPlainRecord } from "~/lib/is-record";

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../../tests/helpers/test-db");
  return { db: createTestDb() };
});

const auth = vi.hoisted((): { user: { id: string } | null } => ({
  user: { id: "u1" },
}));
vi.mock("~/server/auth/request-user", () => ({
  requireRequestUser: () => auth.user,
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
  const req = new NextRequest("http://localhost/api/production", { method: "PUT" });
  req.json = () => Promise.resolve(body);
  return req;
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

  it("目标 project 已归属他人时返回 403 且不覆盖", async () => {
    seedUser(tdb, { id: "u2", email: "u2@test.dev" });
    await productionRepository.upsertForUser("u1", {
      id: "proj_1",
      title: "u1 的",
      shots: [{ id: "s1" }],
    });
    auth.user = { id: "u2" };
    const res = await PUT(
      putRequest({
        project: "proj_1",
        production: {
          title: "u2 篡改",
          shots: [{ id: "bad" }],
        },
      }),
    );
    expect(res.status).toBe(403);
    const got = await productionRepository.getForUser("u1", "proj_1");
    expect(got?.title).toBe("u1 的");
    expect(got?.shots).toEqual([{ id: "s1" }]);
  });
});

function getRequest(project: string | null) {
  const url = new URL("http://localhost/api/production");
  if (project !== null && project !== "") {
    url.searchParams.set("project", project);
  }
  return new NextRequest(url);
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
    const body: unknown = await res.json();
    if (
      !isPlainRecord(body) ||
      typeof body.exists !== "boolean" ||
      !isPlainRecord(body.production) ||
      typeof body.production.title !== "string"
    ) {
      throw new Error(`生产数据响应形状不符：${JSON.stringify(body)}`);
    }
    expect(body.exists).toBe(true);
    expect(body.production.title).toBe("我的短剧");
    expect(body.production.shots).toEqual([{ id: "s1" }]);
  });
});
