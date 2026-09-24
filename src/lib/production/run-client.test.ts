// run-client 封装的契约（Phase 6 · P6-3）：走 vanillaApi.run.*，run 归一、无 projectId 短路。
import { beforeEach, describe, expect, it, vi } from "vitest";

import { vanillaApi } from "~/trpc/vanilla";
import {
  approveRun,
  cancelRun,
  fetchRunStatus,
  pauseRun,
  regenerateShot,
  reviewCharacter,
  reviewShot,
  resumeRun,
  startRun,
} from "./run-client";

vi.mock("~/trpc/vanilla", () => ({
  vanillaApi: {
    run: {
      status: { query: vi.fn() },
      start: { mutate: vi.fn() },
      pause: { mutate: vi.fn() },
      resume: { mutate: vi.fn() },
      approve: { mutate: vi.fn() },
      cancel: { mutate: vi.fn() },
      reviewShot: { mutate: vi.fn() },
      reviewCharacter: { mutate: vi.fn() },
      regenerateShot: { mutate: vi.fn() },
    },
  },
}));

const statusQuery = vi.mocked(vanillaApi.run.status.query);
const startMutate = vi.mocked(vanillaApi.run.start.mutate);
const pauseMutate = vi.mocked(vanillaApi.run.pause.mutate);
const resumeMutate = vi.mocked(vanillaApi.run.resume.mutate);
const approveMutate = vi.mocked(vanillaApi.run.approve.mutate);
const cancelMutate = vi.mocked(vanillaApi.run.cancel.mutate);
const reviewShotMutate = vi.mocked(vanillaApi.run.reviewShot.mutate);
const reviewCharacterMutate = vi.mocked(vanillaApi.run.reviewCharacter.mutate);
const regenerateShotMutate = vi.mocked(vanillaApi.run.regenerateShot.mutate);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchRunStatus", () => {
  it("空 projectId → idle，不发请求", async () => {
    const r = await fetchRunStatus("");
    expect(r.run.status).toBe("idle");
    expect(r.action).toEqual({ kind: "idle" });
    expect(statusQuery).not.toHaveBeenCalled();
  });

  it("脏 run 回包 → 归一", async () => {
    statusQuery.mockResolvedValue({
      run: { status: "乱", approvalMode: "stage" } as never,
      action: { kind: "generate_script" },
    });
    const r = await fetchRunStatus("proj_1");
    expect(r.run.status).toBe("idle"); // 非法回落
    expect(r.action).toEqual({ kind: "generate_script" });
  });
});

describe("run 控制动作", () => {
  it("start 透传入参 + 回快照", async () => {
    startMutate.mockResolvedValue({
      run: { status: "running", approvalMode: "auto" } as never,
      action: { kind: "generate_script" },
    });
    const r = await startRun("proj_1", { goal: "g", approvalMode: "auto" });
    expect(startMutate).toHaveBeenCalledWith({
      projectId: "proj_1",
      goal: "g",
      approvalMode: "auto",
    });
    expect(r.run.status).toBe("running");
    expect(r.run.approvalMode).toBe("auto");
  });

  it("pause / resume / approve / cancel 各调对应 mutation 并回快照", async () => {
    const snap = {
      run: { status: "paused" } as never,
      action: { kind: "idle" as const },
    };
    pauseMutate.mockResolvedValue(snap);
    resumeMutate.mockResolvedValue({
      run: { status: "running" } as never,
      action: snap.action,
    });
    approveMutate.mockResolvedValue(snap);
    cancelMutate.mockResolvedValue(snap);
    expect((await pauseRun("p")).run.status).toBe("paused");
    expect((await resumeRun("p")).run.status).toBe("running");
    expect((await approveRun("p")).run.status).toBe("paused");
    expect((await cancelRun("p")).run.status).toBe("paused");
    expect(pauseMutate).toHaveBeenCalledWith({ projectId: "p" });
    expect(cancelMutate).toHaveBeenCalledWith({ projectId: "p" });
  });
});

describe("评审 / 重生成封装（P8-1b）", () => {
  it("reviewShot 透传 projectId+shotId，回 verdict", async () => {
    const verdict = {
      pass: false,
      issues: ["含混"],
      suggestion: "更具体",
      scoredAt: "t",
    };
    reviewShotMutate.mockResolvedValue({ verdict });
    const r = await reviewShot("proj_1", "s1");
    expect(reviewShotMutate).toHaveBeenCalledWith({
      projectId: "proj_1",
      shotId: "s1",
    });
    expect(r).toEqual(verdict);
  });

  it("reviewCharacter 透传 projectId+characterId，回 verdict", async () => {
    const verdict = {
      pass: true,
      issues: [],
      suggestion: "",
      scoredAt: "t",
    };
    reviewCharacterMutate.mockResolvedValue({ verdict });
    const r = await reviewCharacter("proj_1", "c1");
    expect(reviewCharacterMutate).toHaveBeenCalledWith({
      projectId: "proj_1",
      characterId: "c1",
    });
    expect(r.pass).toBe(true);
  });

  it("regenerateShot(gacha) 不带 newPrompt 时不塞该字段", async () => {
    regenerateShotMutate.mockResolvedValue({ ok: true });
    await regenerateShot("proj_1", "s1", "gacha");
    expect(regenerateShotMutate).toHaveBeenCalledWith({
      projectId: "proj_1",
      shotId: "s1",
      mode: "gacha",
    });
  });

  it("regenerateShot(reprompt) 带 newPrompt 时透传", async () => {
    regenerateShotMutate.mockResolvedValue({ ok: true });
    await regenerateShot("proj_1", "s1", "reprompt", "改进提示词");
    expect(regenerateShotMutate).toHaveBeenCalledWith({
      projectId: "proj_1",
      shotId: "s1",
      mode: "reprompt",
      newPrompt: "改进提示词",
    });
  });
});
