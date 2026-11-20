/**
 * `GET /api/tasks/[id]/stream` —— SSE 执行流的归属闸（越权修复）与日志增量契约（#4605）。
 *
 * 此前只判「已登录」，不判任务归属：任意登录主体可凭他人 taskId 建立执行流，
 * 读到提示词、执行日志与产物清单（tRPC 侧 task.detail/cancel 早就校验归属，
 * 这条 REST 读漏了）。这里钉鉴权与归属两道**拒绝路径**，以及放行之后的
 * 回放/轮询契约。
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { isRecord } from "~/lib/is-record";

const {
  requireRequestUser,
  findByIdForUser,
  findById,
  findSseSnapshot,
  readLogsSince,
  readAllLogs,
  getLogs,
} = vi.hoisted(() => ({
  requireRequestUser: vi.fn<() => Promise<{ id: string } | null>>(),
  findByIdForUser: vi.fn<(userId: string, id: string) => Promise<{ id: string } | null>>(),
  findById: vi.fn<(id: string) => Promise<Record<string, unknown> | null>>(),
  findSseSnapshot: vi.fn<(id: string) => Promise<Record<string, unknown> | null>>(),
  readLogsSince:
    vi.fn<
      (taskId: string, afterSeq: number, limit?: number) => Promise<Array<Record<string, unknown>>>
    >(),
  readAllLogs: vi.fn<(taskId: string) => Promise<Array<Record<string, unknown>>>>(),
  getLogs: vi.fn<(taskId: string) => Array<Record<string, unknown>>>(),
}));

vi.mock("~/server/auth/request-user", () => ({
  requireRequestUser: () => requireRequestUser(),
}));
vi.mock("~/lib/core/repository", () => ({
  taskRepository: {
    findByIdForUser: (userId: string, id: string) => findByIdForUser(userId, id),
    findById: (id: string) => findById(id),
    findSseSnapshot: (id: string) => findSseSnapshot(id),
    readLogsSince: (taskId: string, afterSeq: number, limit?: number) =>
      readLogsSince(taskId, afterSeq, limit),
    readAllLogs: (taskId: string) => readAllLogs(taskId),
  },
}));
/* 这几个只被「放行之后」的轮询/回放用到；隔离掉，免得把执行链模块拖进单测。 */
vi.mock("~/lib/comfyui/enqueue", () => ({ getLogs: (taskId: string) => getLogs(taskId) }));
vi.mock("~/lib/comfyui/validation", () => ({ parseValidationErrors: vi.fn(() => null) }));

function req(id: string): NextRequest {
  return new NextRequest(`http://127.0.0.1:3000/api/tasks/${id}/stream`);
}

function call(id: string): Promise<{ request: NextRequest; res: Response }> {
  const request = req(id);
  return import("./route").then(async ({ GET }) => ({
    request,
    res: await GET(request, { params: Promise.resolve({ id }) }),
  }));
}

type Frame = Record<string, unknown>;

/** 把 SSE 字节流拆成 data 帧（`data: {json}\n\n`；心跳行 `: hb` 不带 data，跳过）。 */
function collectFrames(res: Response, sink: Array<Frame>): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) {
    return Promise.reject(new Error("响应没有可读流"));
  }
  const decoder = new TextDecoder();
  let text = "";
  const pump = async (): Promise<void> => {
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- 流式读取只能逐块 await
      const { value, done } = await reader.read();
      if (done) {
        return;
      }
      text += decoder.decode(value, { stream: true });
      let idx = text.indexOf("\n\n");
      while (idx >= 0) {
        const chunk = text.slice(0, idx);
        text = text.slice(idx + 2);
        if (chunk.startsWith("data: ")) {
          const parsed: unknown = JSON.parse(chunk.slice(6));
          if (isRecord(parsed)) {
            sink.push(parsed);
          }
        }
        idx = text.indexOf("\n\n");
      }
    }
  };
  return pump();
}

/** 从一帧里取日志行的 msg（形状不对给空串——断言自会失败）。 */
function msgOf(frame: Frame): string {
  const entry: unknown = frame.entry;
  if (
    typeof entry === "object" &&
    entry !== null &&
    "msg" in entry &&
    typeof entry.msg === "string"
  ) {
    return entry.msg;
  }
  return "";
}

/** 假定时器下等帧：推进轮询节拍直到凑够 n 帧（有界，防挂死）。 */
async function untilFrames(sink: Array<Frame>, n: number): Promise<void> {
  for (let i = 0; i < 40 && sink.length < n; i += 1) {
    // oxlint-disable-next-line no-await-in-loop -- 假定时器须逐拍推进，帧数到位即停
    await vi.advanceTimersByTimeAsync(250);
  }
  expect(sink.length).toBeGreaterThanOrEqual(n);
}

beforeEach(() => {
  vi.clearAllMocks();
  requireRequestUser.mockResolvedValue({ id: "u-1" });
  findByIdForUser.mockResolvedValue(null);
});

describe("GET /api/tasks/[id]/stream 的归属闸", () => {
  it("未登录 → 401，且不起流", async () => {
    requireRequestUser.mockResolvedValue(null);
    const { res } = await call("t1");
    expect(res.status).toBe(401);
    expect(findByIdForUser).not.toHaveBeenCalled();
  });

  it("任务不属于当前用户 → 404，且不起流、不读快照（越权修复）", async () => {
    findByIdForUser.mockResolvedValue(null);
    const { res } = await call("t-other");
    expect(res.status).toBe(404);
    expect(findByIdForUser).toHaveBeenCalledWith("u-1", "t-other");
  });
});

describe("GET /api/tasks/[id]/stream 的日志增量契约（#4605）", () => {
  it("回放取内存、轮询只发游标之后的增量——先回放后落库的行不重发", async () => {
    vi.useFakeTimers();
    findByIdForUser.mockResolvedValue({ id: "t-1" });
    getLogs.mockReturnValue([{ t: 1, level: "info", msg: "m1", seq: 1 }]);
    findById.mockResolvedValue({
      id: "t-1",
      status: "RUNNING",
      progress: 10,
      error: null,
      validationErrors: null,
      workflowName: "wf",
      progressNode: null,
      resultImages: [],
      logs: null,
    });
    findSseSnapshot.mockResolvedValue({
      status: "RUNNING",
      progress: 10,
      error: null,
      validationErrors: null,
      workflowName: "wf",
      progressNode: null,
      resultImages: [],
    });
    readAllLogs.mockResolvedValue([]);
    // 落库侧晚一拍：游标（seq 1）之后的 m2 才进表。
    readLogsSince.mockResolvedValue([{ seq: 2, t: 2, level: "info", msg: "m2" }]);

    const { res } = await call("t-1");
    expect(res.status).toBe(200);

    const sink: Array<Frame> = [];
    void collectFrames(res, sink);

    await untilFrames(sink, 2);
    // 回放：内存里的 m1 先到，state 随后。
    expect(sink[0]).toEqual({ type: "log", entry: { t: 1, level: "info", msg: "m1", seq: 1 } });
    expect(sink[1]).toMatchObject({ type: "state", status: "RUNNING", progress: 10 });

    // 第一拍轮询：只发游标（seq 1）之后的 m2——m1 不重发。
    await vi.advanceTimersByTimeAsync(3000);
    await untilFrames(sink, 3);
    const logMsgs = sink.filter((f) => f.type === "log").map((f) => msgOf(f));
    expect(logMsgs).toEqual(["m1", "m2"]);
    // delegate 会把可选的 limit 一起透传（undefined = 实现里的缺省 500）。
    expect(readLogsSince).toHaveBeenCalledWith("t-1", 1, undefined);

    /* 收尾不必显式断流：本例跑在假定时器里，轮询/心跳 interval 随用例结束被
     * 丢弃，不会漏进测试进程（真定时器才需要 abort 收口）。 */
    vi.useRealTimers();
  });

  it("内存与增量表都空时回落旧 logs 列（迁移前的历史任务）", async () => {
    vi.useFakeTimers();
    findByIdForUser.mockResolvedValue({ id: "t-old" });
    getLogs.mockReturnValue([]);
    readAllLogs.mockResolvedValue([]);
    findById.mockResolvedValue({
      id: "t-old",
      status: "SUCCEEDED",
      progress: 100,
      error: null,
      validationErrors: null,
      workflowName: "wf",
      progressNode: null,
      resultImages: [{ url: "x.png" }],
      logs: [{ t: 9, level: "info", msg: "旧列里的一行" }],
    });

    const { res } = await call("t-old");
    const sink: Array<Frame> = [];
    void collectFrames(res, sink);

    await untilFrames(sink, 2);
    const logMsgs = sink.filter((f) => f.type === "log").map((f) => msgOf(f));
    expect(logMsgs).toEqual(["旧列里的一行"]);
    // 终态任务回放完即发终态 state（带产出清单）。
    expect(sink.at(-1)).toMatchObject({
      type: "state",
      status: "SUCCEEDED",
      images: [{ url: "x.png" }],
    });

    vi.useRealTimers();
  });
});

describe("GET /api/tasks/[id]/stream 的任务消失出口（#4453 / #4606）", () => {
  it("轮询连续两拍读不到快照 → 发 NOT_FOUND 终态帧并收口流", async () => {
    vi.useFakeTimers();
    findByIdForUser.mockResolvedValue({ id: "t-gone" });
    getLogs.mockReturnValue([]);
    readAllLogs.mockResolvedValue([]);
    findById.mockResolvedValue(null);
    findSseSnapshot.mockResolvedValue(null);

    const { res } = await call("t-gone");
    expect(res.status).toBe(200);

    const sink: Array<Frame> = [];
    const done = collectFrames(res, sink);
    /* 连续两拍（3s 轮询）读不到 → NOT_FOUND 帧；服务端随即收口、流关闭。
     * 客户端（#4606 起）认得这个终态值，不会再走到「重连 404 → 连接中断」。 */
    for (let i = 0; i < 40 && !sink.some((f) => f.status === "NOT_FOUND"); i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- 假定时器须逐拍推进，帧到位即停
      await vi.advanceTimersByTimeAsync(250);
    }
    expect(sink.some((f) => f.status === "NOT_FOUND")).toBe(true);
    expect(sink.find((f) => f.status === "NOT_FOUND")).toMatchObject({
      type: "state",
      error: "任务不存在或已被删除",
    });

    /* 流已收口：读取循环应自然结束（不会挂到用例超时）。 */
    await done;
    vi.useRealTimers();
  });
});
