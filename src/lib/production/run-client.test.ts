// run-client 封装的契约（Phase 6 · P6-3）：走 vanillaApi.run.*，run 归一、无 projectId 短路。
import { beforeEach, describe, expect, it, vi } from "vitest";

import { vanillaApi } from "~/trpc/vanilla";
import {
  DEFAULT_PRODUCTION_RUN,
  type ProductionRun,
  type RunAction,
} from "~/lib/production/run-types";
import {
  approveRun,
  autoselectShot,
  cancelRun,
  fetchReviewCalibration,
  fetchRunStatus,
  pauseRun,
  regenerateShot,
  reviewCharacter,
  reviewScript,
  reviewShot,
  reviewShotImage,
  resumeRun,
  reviseScript,
  setHumanRating,
  setHumanVerdict,
  setScriptHumanVerdict,
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
      reviewScript: { mutate: vi.fn() },
      reviseScript: { mutate: vi.fn() },
      regenerateShot: { mutate: vi.fn() },
      reviewShotImage: { mutate: vi.fn() },
      setHumanVerdict: { mutate: vi.fn() },
      setHumanRating: { mutate: vi.fn() },
      setScriptHumanVerdict: { mutate: vi.fn() },
      reviewCalibration: { query: vi.fn() },
      autoselectShot: { mutate: vi.fn() },
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
const reviewScriptMutate = vi.mocked(vanillaApi.run.reviewScript.mutate);
const reviseScriptMutate = vi.mocked(vanillaApi.run.reviseScript.mutate);
const regenerateShotMutate = vi.mocked(vanillaApi.run.regenerateShot.mutate);
const reviewShotImageMutate = vi.mocked(vanillaApi.run.reviewShotImage.mutate);
const setHumanVerdictMutate = vi.mocked(vanillaApi.run.setHumanVerdict.mutate);
const setHumanRatingMutate = vi.mocked(vanillaApi.run.setHumanRating.mutate);
const setScriptHumanVerdictMutate = vi.mocked(vanillaApi.run.setScriptHumanVerdict.mutate);
const reviewCalibrationQuery = vi.mocked(vanillaApi.run.reviewCalibration.query);
const autoselectShotMutate = vi.mocked(vanillaApi.run.autoselectShot.mutate);

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
    const dirtyRun = { ...DEFAULT_PRODUCTION_RUN };
    Reflect.set(dirtyRun, "status", "乱");
    statusQuery.mockResolvedValue({
      run: dirtyRun,
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
      run: { ...DEFAULT_PRODUCTION_RUN, status: "running", approvalMode: "auto" },
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
    const snap: { action: RunAction; run: ProductionRun } = {
      run: { ...DEFAULT_PRODUCTION_RUN, status: "paused" },
      action: { kind: "idle" },
    };
    pauseMutate.mockResolvedValue(snap);
    resumeMutate.mockResolvedValue({
      run: { ...DEFAULT_PRODUCTION_RUN, status: "running" },
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

  it("reviewScript 透传 projectId（剧本无实体 id），回判定与完整曲线", async () => {
    const verdict = {
      pass: false,
      issues: ["高潮缺失"],
      suggestion: "补一场对峙",
      scoredAt: "t",
      rubricVersion: "script-v1",
    };
    reviewScriptMutate.mockResolvedValue({ verdict, history: [verdict] });
    const r = await reviewScript("proj_1");
    expect(reviewScriptMutate).toHaveBeenCalledWith({ projectId: "proj_1" });
    expect(r.verdict.rubricVersion).toBe("script-v1");
    expect(r.history).toHaveLength(1);
  });

  it("reviseScript 透传 projectId，回改写后的完整剧本（#2478）", async () => {
    reviseScriptMutate.mockResolvedValue({
      markdown: "## 场景1 · 改写后的剧本",
    });
    const md = await reviseScript("proj_1");
    expect(reviseScriptMutate).toHaveBeenCalledWith({ projectId: "proj_1" });
    expect(md).toBe("## 场景1 · 改写后的剧本");
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

describe("人工侧 / 抽卡优选封装（FR-QA-04④ / FR-QA-07）", () => {
  it("reviewShotImage 只回判定本身，服务端已落库", async () => {
    const verdict = { issues: [], pass: true, scoredAt: "t", suggestion: "" };
    reviewShotImageMutate.mockResolvedValue({ verdict });
    const r = await reviewShotImage("proj_1", "s1");
    expect(reviewShotImageMutate).toHaveBeenCalledWith({ projectId: "proj_1", shotId: "s1" });
    expect(r).toEqual(verdict);
  });

  it("setHumanVerdict 透传四个入参 + 缺省 note 为空串", async () => {
    const humanVerdict = { at: "t", note: "", pass: true, rev: 1 };
    setHumanVerdictMutate.mockResolvedValue({ humanVerdict });
    const r = await setHumanVerdict("proj_1", "character", "c1", true);
    expect(setHumanVerdictMutate).toHaveBeenCalledWith({
      projectId: "proj_1",
      kind: "character",
      targetId: "c1",
      pass: true,
      note: "",
    });
    expect(r).toEqual(humanVerdict);
  });

  it("setHumanRating：数字与 null（清除）都原样透传", async () => {
    setHumanRatingMutate.mockResolvedValue({ ok: true });
    await setHumanRating("proj_1", "s1", 4);
    expect(setHumanRatingMutate).toHaveBeenLastCalledWith({
      projectId: "proj_1",
      shotId: "s1",
      rating: 4,
    });
    await setHumanRating("proj_1", "s1", null);
    expect(setHumanRatingMutate).toHaveBeenLastCalledWith({
      projectId: "proj_1",
      shotId: "s1",
      rating: null,
    });
  });

  it("setScriptHumanVerdict 回裁决快照（带剧本指纹）", async () => {
    const humanVerdict = { at: "t", digest: "d1", note: "可以", pass: true };
    setScriptHumanVerdictMutate.mockResolvedValue({ humanVerdict });
    const r = await setScriptHumanVerdict("proj_1", true, "可以");
    expect(setScriptHumanVerdictMutate).toHaveBeenCalledWith({
      projectId: "proj_1",
      pass: true,
      note: "可以",
    });
    expect(r.digest).toBe("d1");
  });

  it("fetchReviewCalibration 是只读 query，原样回聚合读数", async () => {
    const report = {
      aiMeanAvg: null,
      decisionAgreement: null,
      humanAvg: null,
      mae: null,
      perDimension: [],
      samples: 0,
    };
    reviewCalibrationQuery.mockResolvedValue(report);
    const r = await fetchReviewCalibration("proj_1");
    expect(reviewCalibrationQuery).toHaveBeenCalledWith({ projectId: "proj_1" });
    expect(r).toMatchObject({ samples: 0, perDimension: [] });
  });

  it("autoselectShot 透传候选任务列表，原样回优选结果", async () => {
    const winner = {
      candidates: [{ imageUrl: "/a.png", taskId: "t1", verdict: null }],
      winnerImageUrl: "/a.png",
      winnerTaskId: "t1",
      winnerVerdict: { issues: [], pass: true, scoredAt: "t", suggestion: "" },
    };
    autoselectShotMutate.mockResolvedValue(winner);
    const r = await autoselectShot("proj_1", "s1", ["t1", "t2"]);
    expect(autoselectShotMutate).toHaveBeenCalledWith({
      projectId: "proj_1",
      shotId: "s1",
      taskIds: ["t1", "t2"],
    });
    expect(r.winnerTaskId).toBe("t1");
  });
});
