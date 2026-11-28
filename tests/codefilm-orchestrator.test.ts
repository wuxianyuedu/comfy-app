/** 编排器行为测试：合同落库、按镜顺序入队、失败补偿取消、QA 前置拒绝。 */
import { describe, expect, it, vi } from "vitest";
import type * as LoggerModule from "~/lib/core/logger";

vi.mock("~/lib/core/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof LoggerModule>()),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("~/lib/core/repository-production", () => ({
  productionRepository: { patchContent: vi.fn() },
}));
vi.mock("~/lib/comfyui/enqueue", () => ({ cancelTask: vi.fn() }));
vi.mock("~/lib/workshop/workflow-run.server", () => ({ createWorkflowRunTask: vi.fn() }));

import { codeFilmContractSchema } from "~/lib/codefilm/contract-schema";
import { runCodeFilm } from "~/server/codefilm/orchestrator";

const CONTRACT = codeFilmContractSchema.parse({
  meta: { title: "打斗", fps: 24 },
  layout: [
    { id: "hero", kind: "character", position: { x: 0, y: 0 } },
    { id: "foe", kind: "character", position: { x: 5, y: 0 } },
  ],
  shots: [
    {
      id: "s1",
      index: 0,
      description: "对峙",
      duration: 1,
      characterIds: ["hero", "foe"],
    },
    {
      id: "s2",
      index: 1,
      description: "挥拳",
      duration: 1,
      characterIds: ["hero"],
      actionBeats: [{ t: 0, actorId: "hero", action: "挥拳", targetId: "foe" }],
    },
  ],
  timeline: {
    totalFrames: 48,
    shots: [
      { shotId: "s1", startFrame: 0, endFrame: 24 },
      { shotId: "s2", startFrame: 24, endFrame: 48 },
    ],
  },
});

describe("codefilm / orchestrator", () => {
  it("按镜顺序入队并落库，返回逐镜 taskId", async () => {
    const order: Array<string> = [];
    const result = await runCodeFilm(
      {
        contract: CONTRACT,
        projectId: "proj-1",
        userId: "u1",
        videoWorkflowId: "wf-1",
      },
      {
        patchShots: () => {
          order.push("patch");
          return Promise.resolve(true);
        },
        enqueue: ({ shotId }) => {
          order.push(shotId);
          return Promise.resolve({ taskId: `t-${shotId}` });
        },
        cancel: () => Promise.resolve(),
      },
    );
    expect(order).toEqual(["patch", "s1", "s2"]);
    expect(result.tasks).toEqual([
      { shotId: "s1", taskId: "t-s1" },
      { shotId: "s2", taskId: "t-s2" },
    ]);
    expect(result.shotsWritten).toBe(2);
  });

  it("入队中途失败时补偿取消已建任务", async () => {
    const cancelled: Array<string> = [];
    const err = await runCodeFilm(
      {
        contract: CONTRACT,
        userId: "u1",
        videoWorkflowId: "wf-1",
      },
      {
        enqueue: ({ shotId }) => {
          if (shotId === "s2") {
            return Promise.reject(new Error("入队失败"));
          }
          return Promise.resolve({ taskId: `t-${shotId}` });
        },
        cancel: (taskId) => {
          cancelled.push(taskId);
          return Promise.resolve();
        },
      },
    ).catch((error: unknown) => error);
    expect(err).toBeInstanceOf(Error);
    expect(cancelled).toEqual(["t-s1"]);
  });

  it("落库失败抛 NOT_FOUND 且不入队", async () => {
    const enqueue = vi.fn();
    const err = await runCodeFilm(
      {
        contract: CONTRACT,
        projectId: "proj-missing",
        userId: "u1",
        videoWorkflowId: "wf-1",
      },
      {
        patchShots: () => Promise.resolve(false),
        enqueue,
      },
    ).catch((error: unknown) => error);
    expect(err).toMatchObject({ code: "NOT_FOUND" });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("QA 不通过的合同在落库 / 入队之前拒绝", async () => {
    const patchShots = vi.fn();
    const enqueue = vi.fn();
    const bad = codeFilmContractSchema.parse({
      ...CONTRACT,
      shots: [{ ...CONTRACT.shots[0]!, characterIds: ["ghost"] }, CONTRACT.shots[1]!],
    });
    const err = await runCodeFilm(
      { contract: bad, userId: "u1", videoWorkflowId: "wf-1" },
      { patchShots, enqueue },
    ).catch((error: unknown) => error);
    expect(err).toMatchObject({ code: "BAD_REQUEST" });
    expect(patchShots).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
