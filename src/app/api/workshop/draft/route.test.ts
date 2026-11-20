/**
 * `/api/workshop/draft` 的归属闸（ISSUE #4556 越权修复）。
 *
 * 此前 GET/PUT/DELETE 只判「已登录」，不判草稿归属：任意登录主体可凭他人
 * 项目 id 读、写（并接管归属）、删他人的工坊草稿（剧本/分镜/角色）。
 * 这里钉住：未登录 401；他人草稿 GET 不可见（exists:false）、PUT 404 且
 * 不落 upsert、DELETE 已然无恙（alreadyGone:true，不泄露存在性）；本人
 * 与无主（历史行）照常。
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRequestUser, getDraft, findDraftOwner, listDraftsByUser, upsertDraft, deleteDraft } =
  vi.hoisted(() => ({
    requireRequestUser: vi.fn<() => Promise<{ id: string } | null>>(),
    getDraft: vi.fn<(id: string, userId: string) => Promise<Record<string, unknown> | null>>(),
    findDraftOwner:
      vi.fn<(id: string) => Promise<{ updatedAt: Date; userId: string | null } | null>>(),
    listDraftsByUser: vi.fn<(userId: string) => Promise<Array<Record<string, unknown>>>>(),
    upsertDraft: vi.fn<(id: string, draft: unknown, userId: string | null) => Promise<void>>(),
    deleteDraft: vi.fn<(id: string, userId: string) => Promise<boolean>>(),
  }));

vi.mock("~/server/auth/request-user", () => ({
  requireRequestUser: () => requireRequestUser(),
}));
vi.mock("~/server/workshop/draft-repository", () => ({
  getDraft: (id: string, userId: string) => getDraft(id, userId),
  findDraftOwner: (id: string) => findDraftOwner(id),
  listDraftsByUser: (userId: string) => listDraftsByUser(userId),
  upsertDraft: (id: string, draft: unknown, userId: string | null) =>
    upsertDraft(id, draft, userId),
  deleteDraft: (id: string, userId: string) => deleteDraft(id, userId),
}));

function call(method: "GET" | "DELETE", query = ""): Promise<Response> {
  const req = new NextRequest(`http://127.0.0.1:3000/api/workshop/draft${query}`);
  return import("./route").then(({ GET, DELETE }) => (method === "GET" ? GET(req) : DELETE(req)));
}

function put(body: Record<string, unknown>): Promise<Response> {
  const req = new NextRequest("http://127.0.0.1:3000/api/workshop/draft", {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return import("./route").then(({ PUT }) => PUT(req));
}

beforeEach(() => {
  vi.clearAllMocks();
  requireRequestUser.mockResolvedValue({ id: "u-1" });
  getDraft.mockResolvedValue(null);
  findDraftOwner.mockResolvedValue(null);
  listDraftsByUser.mockResolvedValue([]);
  deleteDraft.mockResolvedValue(false);
});

describe("GET /api/workshop/draft 的归属闸", () => {
  it("未登录 → 401，且不读草稿", async () => {
    requireRequestUser.mockResolvedValue(null);
    const res = await call("GET", "?project=wsp_1");
    expect(res.status).toBe(401);
    expect(getDraft).not.toHaveBeenCalled();
  });

  it("他人草稿 → exists:false（与不存在同形，不泄露存在性）", async () => {
    getDraft.mockResolvedValue(null);
    const res = await call("GET", "?project=wsp_other");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ exists: false });
    expect(getDraft).toHaveBeenCalledWith("wsp_other", "u-1");
  });

  it("本人草稿 → exists:true + draft", async () => {
    const draft = {
      meta: { title: "我的草稿" },
      scriptMarkdown: "# 有内容",
      scenes: [],
      characters: [],
      shots: [],
    };
    getDraft.mockResolvedValue(draft);
    const res = await call("GET", "?project=wsp_mine");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ exists: true, draft });
  });

  it("不带 project → 列当前用户的服务端草稿摘要", async () => {
    listDraftsByUser.mockResolvedValue([{ id: "wsp_mine", title: "t", updatedAt: "2026-01-01" }]);
    const res = await call("GET");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      drafts: [{ id: "wsp_mine", title: "t", updatedAt: "2026-01-01" }],
    });
    expect(listDraftsByUser).toHaveBeenCalledWith("u-1");
  });
});

describe("PUT /api/workshop/draft 的归属闸", () => {
  it("未登录 → 401，且不落草稿", async () => {
    requireRequestUser.mockResolvedValue(null);
    const res = await put({ project: "wsp_1", draft: {} });
    expect(res.status).toBe(401);
    expect(upsertDraft).not.toHaveBeenCalled();
  });

  it("他人草稿 → 404，且不落 upsert（越权修复：写与接管都被拒）", async () => {
    findDraftOwner.mockResolvedValue({ userId: "u-other", updatedAt: new Date() });
    const res = await put({ project: "wsp_other", draft: { meta: { title: "劫持" } } });
    expect(res.status).toBe(404);
    expect(findDraftOwner).toHaveBeenCalledWith("wsp_other");
    expect(upsertDraft).not.toHaveBeenCalled();
  });

  it("本人草稿 → ok:true，归属与内容照常写入", async () => {
    findDraftOwner.mockResolvedValue({ userId: "u-1", updatedAt: new Date() });
    const res = await put({ project: "wsp_mine", draft: { meta: { title: "v2" } } });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(upsertDraft).toHaveBeenCalledTimes(1);
    expect(upsertDraft.mock.calls[0]?.[0]).toBe("wsp_mine");
    expect(upsertDraft.mock.calls[0]?.[2]).toBe("u-1");
  });

  it("无主历史行（不存在记录）→ ok:true，可写入", async () => {
    findDraftOwner.mockResolvedValue(null);
    const res = await put({ project: "wsp_new", draft: { meta: { title: "新" } } });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(upsertDraft).toHaveBeenCalledTimes(1);
  });

  it("更旧的 PUT（ifNewer）→ stale:true，不覆盖较新镜像", async () => {
    findDraftOwner.mockResolvedValue({
      userId: "u-1",
      updatedAt: new Date("2026-01-02T00:00:00Z"),
    });
    const res = await put({
      project: "wsp_mine",
      draft: { meta: { title: "旧" }, updatedAt: new Date("2026-01-01T00:00:00Z").getTime() },
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, stale: true });
    expect(upsertDraft).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/workshop/draft 的归属闸", () => {
  it("未登录 → 401，且不删", async () => {
    requireRequestUser.mockResolvedValue(null);
    const res = await call("DELETE", "?project=wsp_1");
    expect(res.status).toBe(401);
    expect(deleteDraft).not.toHaveBeenCalled();
  });

  it("他人草稿 → alreadyGone:true（删不动，与不存在同形，不泄露存在性）", async () => {
    deleteDraft.mockResolvedValue(false);
    const res = await call("DELETE", "?project=wsp_other");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, alreadyGone: true });
    expect(deleteDraft).toHaveBeenCalledWith("wsp_other", "u-1");
  });

  it("本人草稿 → ok:true + alreadyGone:false", async () => {
    deleteDraft.mockResolvedValue(true);
    const res = await call("DELETE", "?project=wsp_mine");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, alreadyGone: false });
  });
});
