/**
 * `GET /api/tasks/[id]/stream` —— SSE 执行流的归属闸（越权修复）。
 *
 * 此前只判「已登录」，不判任务归属：任意登录主体可凭他人 taskId 建立执行流，
 * 读到提示词、执行日志与产物清单（tRPC 侧 task.detail/cancel 早就校验归属，
 * 这条 REST 读漏了）。这里只钉鉴权与归属两道**拒绝路径**——放行之后的轮询
 * 会起真实定时器，属既有行为，不在本用例展开（避免测试进程残留 interval）。
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRequestUser, findByIdForUser } = vi.hoisted(() => ({
  requireRequestUser: vi.fn<() => Promise<{ id: string } | null>>(),
  findByIdForUser: vi.fn<(userId: string, id: string) => Promise<{ id: string } | null>>(),
}));

vi.mock("~/server/auth/request-user", () => ({
  requireRequestUser: () => requireRequestUser(),
}));
vi.mock("~/lib/core/repository", () => ({
  taskRepository: {
    findByIdForUser: (userId: string, id: string) => findByIdForUser(userId, id),
  },
}));
/* 这三个只被「放行之后」的轮询/回放用到；隔离掉，免得把执行链模块拖进单测。 */
vi.mock("~/lib/comfyui/enqueue", () => ({ getLogs: vi.fn() }));
vi.mock("~/lib/comfyui/validation", () => ({ parseValidationErrors: vi.fn() }));
vi.mock("~/lib/task-state", () => ({ isTerminalTaskStatus: vi.fn() }));

function req(id: string): NextRequest {
  return new NextRequest(`http://127.0.0.1:3000/api/tasks/${id}/stream`);
}

function call(id: string): Promise<Response> {
  return import("./route").then(({ GET }) => GET(req(id), { params: Promise.resolve({ id }) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  requireRequestUser.mockResolvedValue({ id: "u-1" });
  findByIdForUser.mockResolvedValue(null);
});

describe("GET /api/tasks/[id]/stream 的归属闸", () => {
  it("未登录 → 401，且不起流", async () => {
    requireRequestUser.mockResolvedValue(null);
    const res = await call("t1");
    expect(res.status).toBe(401);
    expect(findByIdForUser).not.toHaveBeenCalled();
  });

  it("任务不属于当前用户 → 404，且不起流、不读快照（越权修复）", async () => {
    findByIdForUser.mockResolvedValue(null);
    const res = await call("t-other");
    expect(res.status).toBe(404);
    expect(findByIdForUser).toHaveBeenCalledWith("u-1", "t-other");
  });
  /* 放行（本人任务 → 200 建流）这一档不在此展开：一旦建流就会起轮询/心跳定时器，
   * 而本路由的 ReadableStream 未定义 cancel 回调，测试里断开也收不掉，会往测试
   * 进程漏 interval。归属放行属既有行为，由 SSE 消费侧的既有用例覆盖。 */
});
