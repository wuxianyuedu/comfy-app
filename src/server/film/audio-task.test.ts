/**
 * 逐镜 TTS 任务与监看回写（ISSUE #5244）：建任务 / 重试 / 产物写回的行为用例。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createTask, patchParams, findProgress, appendLog } = vi.hoisted(() => ({
  createTask: vi.fn(() => Promise.resolve({ taskId: "tts-1" })),
  patchParams: vi.fn(() => Promise.resolve()),
  findProgress: vi.fn(() => Promise.resolve([] as Array<Record<string, unknown>>)),
  appendLog: vi.fn(() => Promise.resolve()),
}));

vi.mock("~/lib/workshop/workflow-run.server", () => ({ createWorkflowRunTask: createTask }));
vi.mock("~/lib/core/repository", () => ({
  filmShotRepository: { patchParams },
  taskRepository: { findExecutionProgressMany: findProgress },
}));
vi.mock("./film-log", () => ({ appendFilmLog: appendLog }));

import { ensureShotAudio, syncShotAudio } from "./audio-task";

const withTts = {
  audioAttempts: 0,
  ttsParams: { text: "你好" },
  ttsWorkflowId: "wf-tts",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ensureShotAudio", () => {
  it("没配 TTS 工作流 / 载荷 / 已有产物时不建任务", async () => {
    await ensureShotAudio("u", "f", "s", { ttsParams: { text: "x" } });
    await ensureShotAudio("u", "f", "s", { ttsWorkflowId: "wf" });
    await ensureShotAudio("u", "f", "s", { ...withTts, audioPath: "/api/generated/a.mp3" });
    expect(createTask).not.toHaveBeenCalled();
  });

  it("有载荷时建任务并把 taskId/尝试次数落进镜头参数", async () => {
    await ensureShotAudio("u", "f", "s", withTts);
    expect(createTask).toHaveBeenCalledWith({
      userId: "u",
      workflowId: "wf-tts",
      values: { text: "你好" },
    });
    expect(patchParams).toHaveBeenCalledWith("s", { audioAttempts: 1, audioTaskId: "tts-1" });
  });

  it("业务失败不重试；瞬时故障在尝试上限内重建", async () => {
    await ensureShotAudio("u", "f", "s", {
      ...withTts,
      audioAttempts: 2,
      audioError: "工作流不存在",
    });
    expect(createTask).not.toHaveBeenCalled();
    await ensureShotAudio("u", "f", "s", {
      ...withTts,
      audioAttempts: 1,
      audioError: "Gateway Timeout",
    });
    expect(createTask).toHaveBeenCalledTimes(1);
  });
});

describe("syncShotAudio", () => {
  it("没有在飞音频任务时不查库", async () => {
    await syncShotAudio([{ id: "s", params: { ttsWorkflowId: "wf" } }], "f");
    expect(findProgress).not.toHaveBeenCalled();
  });

  it("成功后写回 audioPath，失败清掉 taskId 让下一轮重建", async () => {
    findProgress.mockResolvedValueOnce([
      {
        id: "tts-1",
        resultImages: [{ localPath: "/generated/a.mp3", mediaType: "audio" }],
        status: "SUCCEEDED",
      },
      { id: "tts-2", status: "FAILED" },
    ]);
    await syncShotAudio(
      [
        { id: "s1", params: { audioTaskId: "tts-1" } },
        { id: "s2", params: { audioTaskId: "tts-2" } },
      ],
      "f",
    );
    expect(patchParams).toHaveBeenCalledWith("s1", { audioPath: "/generated/a.mp3" });
    expect(patchParams).toHaveBeenCalledWith("s2", {
      audioError: "TTS 任务失败",
      audioTaskId: "",
    });
  });
});
