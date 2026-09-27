/**
 * `queue-status.server.ts` 的聚合改读**库里那几行**（P3 §5 ADR §14 D1 的 4-B2）。
 *
 * 钉的是跨宿主可见性：这一格的四个字段此前全从 Next 进程的内存取（`runnerState`
 * 的 `queue` / `startedAt` / `executedWorkflow` / `lastNodeByTask`），执行权一旦
 * 归另一个宿主，用户看到的就是「排队 0、在跑 null」——而串行队列里最想知道的
 * 恰恰是「前面堵几个、当前这个跑了多久、用的什么模型」。
 *
 * 仓储与网络层都换桩（`getComfyQueue` 会打真 ComfyUI），`primaryModelName` 与
 * `queueTraceSummary` 用**真实现**：这两份解析正是这一格的内容本身，mock 掉
 * 就等于把要验的东西跳过。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { stripComments } from "../../../tests/helpers/strip-comments";

/* 三条桩件收在 hoisted 句柄上，断言直接对着句柄写（从模块对象上取方法会踩
 * `unbound-method` 判据）；`state` 是用例间可改的输入。 */
const stub = vi.hoisted(() => {
  const state = {
    running: null as Record<string, unknown> | null,
    queued: 0,
  };
  return {
    state,
    findRunning: vi.fn(async (): Promise<unknown> => state.running),
    countQueued: vi.fn(async () => state.queued),
    getQueue: vi.fn(async (): Promise<unknown> => ({
      queue_running: [{ prompt_id: "p1" }],
      queue_pending: [{ prompt_id: "p2" }, { prompt_id: "p3" }],
    })),
  };
});

vi.mock("~/lib/core/repository-task", () => ({
  taskRepository: {
    findRunningForStatusBar: stub.findRunning,
    countQueuedForStatusBar: stub.countQueued,
  },
}));
vi.mock("~/lib/comfyui/client", () => ({ getComfyQueue: stub.getQueue }));

const mod = await import("./queue-status.server");

/* 一条真实的 UI 格式载荷（截自实际跑过的 raw 图）：状态栏的「主模型」就是从
 * 这种形状里认出来的，API 格式那条分支由 `executed-model.test.ts` 覆盖。 */
const RAW_WITH_MODEL = {
  nodes: [
    {
      id: 1,
      type: "CheckpointLoaderSimple",
      widgets_values: ["flux1-dev.safetensors", "fp8"],
    },
  ],
};

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "t-1",
    workflowName: "image_z_image_int8_t2i",
    progress: 42,
    progressNode: {
      id: "7",
      classType: "KSampler",
      label: "采样器",
      value: 3,
      max: 20,
    },
    claimedAt: new Date("2026-01-01T00:00:10.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    execPayload: RAW_WITH_MODEL,
    ...overrides,
  };
}

beforeEach(() => {
  stub.state.running = baseRow();
  stub.state.queued = 2;
  // 三条句柄在用例间不清零的话，「各发一次」那条会累计成 8 次。
  stub.findRunning.mockClear();
  stub.countQueued.mockClear();
  stub.getQueue.mockReset().mockImplementation(async () => ({
    queue_running: [{ prompt_id: "p1" }],
    queue_pending: [{ prompt_id: "p2" }, { prompt_id: "p3" }],
  }));
});

describe("状态栏那一格的全部来源都是库", () => {
  it("在跑的那条 + 排队数 + ComfyUI 自己的口径，一次采齐", async () => {
    const status = await mod.collectComfyQueueStatus();

    expect(status).toEqual({
      online: true,
      comfy: { running: 1, pending: 2 },
      queued: 2,
      running: {
        taskId: "t-1",
        workflowName: "image_z_image_int8_t2i",
        model: "flux1-dev.safetensors",
        startedAt: Date.parse("2026-01-01T00:00:10.000Z"),
        progress: 42,
        nodeType: "KSampler",
      },
    });
  });

  it("耗时优先用 claimedAt；那一列为 NULL 的旧行才退回提交时刻", async () => {
    stub.state.running = baseRow({ claimedAt: null });
    const withCreated = await mod.collectComfyQueueStatus();
    expect(withCreated.running?.startedAt).toBe(
      Date.parse("2026-01-01T00:00:00.000Z"),
    );

    stub.state.running = baseRow();
    const withClaimed = await mod.collectComfyQueueStatus();
    expect(withClaimed.running?.startedAt).toBe(
      Date.parse("2026-01-01T00:00:10.000Z"),
    );
  });

  it("没有 RUNNING 行：running 为 null，排队数照常给（这一格不该整条消失）", async () => {
    stub.state.running = null;
    const status = await mod.collectComfyQueueStatus();

    expect(status.running).toBeNull();
    expect(status.queued).toBe(2);
    expect(status.online).toBe(true);
  });

  it("认不出主模型 / 没有节点信息时不炸，两格各自退成 null", async () => {
    stub.state.running = baseRow({
      execPayload: { nodes: [{ id: 1, type: "EmptyLatentImage" }] },
      progressNode: null,
    });

    const status = await mod.collectComfyQueueStatus();
    expect(status.running?.model).toBeNull();
    expect(status.running?.nodeType).toBeNull();
    // 其余字段不受影响：用户仍在看进度。
    expect(status.running?.progress).toBe(42);
  });

  it("cli 那条进度事件没有 classType 时，节点类名为 null（与内存版旧行为一致）", async () => {
    stub.state.running = baseRow({
      progressNode: { id: "7", value: 3, max: 20 },
    });
    const status = await mod.collectComfyQueueStatus();
    expect(status.running?.nodeType).toBeNull();
  });

  it("ComfyUI 不可达：整格降级成离线，但仍把库里那两个数报出来", async () => {
    stub.getQueue.mockResolvedValueOnce(null);

    const status = await mod.collectComfyQueueStatus();

    expect(status.online).toBe(false);
    expect(status.comfy).toEqual({ running: 0, pending: 0 });
    expect(status.queued).toBe(2);
    expect(status.running?.taskId).toBe("t-1");
  });

  it("三条读各发一次：没有为拿一个字段再回查一遍", async () => {
    await mod.collectComfyQueueStatus();

    expect(stub.findRunning).toHaveBeenCalledTimes(1);
    expect(stub.countQueued).toHaveBeenCalledTimes(1);
    expect(stub.getQueue).toHaveBeenCalledTimes(1);
  });

  it("源形态：这一格不再从执行进程的内存取数（这一刀的判据本身）", async () => {
    const source = stripComments(
      readFileSync(
        path.resolve(process.cwd(), "src/lib/comfyui/queue-status.server.ts"),
        "utf-8",
      ),
    );
    expect(source).not.toMatch(/runner-state/);
    expect(source).not.toMatch(/\bstate\(\)/);
    expect(source).toMatch(/taskRepository\.findRunningForStatusBar/);
    expect(source).toMatch(/taskRepository\.countQueuedForStatusBar/);
  });
});
