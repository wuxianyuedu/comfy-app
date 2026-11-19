/**
 * `GET /api/tasks/[id]/raw-cli` —— comfy-cli 原始输出的归属闸（越权修复）。
 *
 * 此前只判「已登录」，不判任务归属：任意登录主体可凭他人 taskId 读到完整
 * comfy-cli 原始输出（含提示词、参数与内部路径）。这里钉住四条：未登录 401、
 * 非本人任务 404 且不落到原始输出读取、本人任务返回行、无记录回落空数组。
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRequestUser, findByIdForUser, findRawCli } = vi.hoisted(() => ({
  requireRequestUser: vi.fn<() => Promise<{ id: string } | null>>(),
  findByIdForUser: vi.fn<(userId: string, id: string) => Promise<{ id: string } | null>>(),
  findRawCli: vi.fn<(taskId: string) => Promise<Array<string> | null>>(),
}));

vi.mock("~/server/auth/request-user", () => ({
  requireRequestUser: () => requireRequestUser(),
}));
vi.mock("~/lib/core/repository-task", () => ({
  taskRepository: {
    findByIdForUser: (userId: string, id: string) => findByIdForUser(userId, id),
    findRawCli: (taskId: string) => findRawCli(taskId),
  },
}));

function req(id: string): NextRequest {
  return new NextRequest(`http://127.0.0.1:3000/api/tasks/${id}/raw-cli`);
}

function call(id: string): Promise<Response> {
  return import("./route").then(({ GET }) => GET(req(id), { params: Promise.resolve({ id }) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  requireRequestUser.mockResolvedValue({ id: "u-1" });
  findByIdForUser.mockResolvedValue(null);
  findRawCli.mockResolvedValue(null);
});

describe("GET /api/tasks/[id]/raw-cli 的归属闸", () => {
  it("未登录 → 401，且不读原始输出", async () => {
    requireRequestUser.mockResolvedValue(null);
    const res = await call("t1");
    expect(res.status).toBe(401);
    expect(findRawCli).not.toHaveBeenCalled();
  });

  it("任务不属于当前用户 → 404，且不读原始输出（越权修复）", async () => {
    findByIdForUser.mockResolvedValue(null);
    const res = await call("t-other");
    expect(res.status).toBe(404);
    expect(findByIdForUser).toHaveBeenCalledWith("u-1", "t-other");
    expect(findRawCli).not.toHaveBeenCalled();
  });

  it("本人任务 → 返回 comfy-cli 原始行", async () => {
    findByIdForUser.mockResolvedValue({ id: "t1" });
    findRawCli.mockResolvedValue(["[comfy-cli] step 1", "step 2"]);
    const res = await call("t1");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ lines: ["[comfy-cli] step 1", "step 2"] });
    expect(findRawCli).toHaveBeenCalledWith("t1");
  });

  it("本人任务但无记录 → 空数组（前端据此显示空态）", async () => {
    findByIdForUser.mockResolvedValue({ id: "t2" });
    findRawCli.mockResolvedValue(null);
    const res = await call("t2");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ lines: [] });
  });
});
