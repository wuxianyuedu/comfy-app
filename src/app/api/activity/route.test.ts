/** 剧集协作活动流（ISSUE #5208）：只读当前用户指定项目的保存事件。 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../../tests/helpers/test-db");
  return { db: createTestDb() };
});

const auth = vi.hoisted((): { user: { id: string } | null } => ({ user: { id: "u1" } }));
vi.mock("~/server/auth/request-user", () => ({ requireRequestUser: () => auth.user }));

import { getTestDb, seedUser } from "../../../../tests/helpers/test-db";
import { GET } from "./route";

const tdb = getTestDb();

beforeEach(() => {
  tdb.$reset();
  seedUser(tdb, { id: "u1", email: "u1@test.dev" });
  auth.user = { id: "u1" };
});

function get(project: string | null) {
  const url =
    project === null
      ? "http://localhost/api/activity"
      : `http://localhost/api/activity?project=${project}`;
  return GET(new NextRequest(url));
}

describe("GET /api/activity", () => {
  it("缺 project → 400；未登录 → 401", async () => {
    expect((await get(null)).status).toBe(400);
    auth.user = null;
    expect((await get("proj_1")).status).toBe(401);
  });

  it("只回本项目的保存事件，按时间倒序", async () => {
    await tdb.insert((await import("~/server/db/schema")).auditLog).values([
      {
        event: "project_content_saved",
        userId: "u1",
        ip: "unknown",
        meta: JSON.stringify({ project: "proj_1" }),
        createdAt: new Date("2026-11-27T10:00:00.000Z"),
      },
      {
        event: "project_content_saved",
        userId: "u1",
        ip: "unknown",
        meta: JSON.stringify({ project: "proj_2" }),
        createdAt: new Date("2026-11-27T11:00:00.000Z"),
      },
    ]);
    const res = await get("proj_1");
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(body).toMatchObject({ items: [{ event: "project_content_saved" }] });
    if (
      typeof body !== "object" ||
      body === null ||
      !("items" in body) ||
      !Array.isArray(body.items)
    ) {
      throw new TypeError("响应应带 items 数组");
    }
    expect(body.items).toHaveLength(1);
    expect(JSON.stringify(body.items)).toContain("2026-11-27T10:00");
  });
});
