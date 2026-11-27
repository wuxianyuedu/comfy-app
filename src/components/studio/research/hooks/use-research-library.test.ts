// @vitest-environment happy-dom
/**
 * 调研页共用逻辑层的行为契约（规范 11 §11.2）：本地通道留 taskId 且可单条取消，
 * 远端通道留住库所需元数据且不可取消；两条通道都按注入的提示词拼法生成。
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cancelTask } from "~/lib/task-cancel-client";

import { useResearchLibrary } from "./use-research-library";
import type { ResearchPreset } from "../research-preset-types";

const mocks = vi.hoisted(() => ({
  apiGenerateImage: vi.fn(),
  buildLibraryWorkflowInput: vi.fn(),
  cancelTask: vi.fn(),
  observeTaskUntilSettled: vi.fn(),
  startLocalGenerate: vi.fn(),
}));

vi.mock("~/lib/task-cancel-client", () => ({ cancelTask: mocks.cancelTask }));
vi.mock("~/lib/workshop/generation-client", () => ({
  buildLibraryWorkflowInput: mocks.buildLibraryWorkflowInput,
  startLocalGenerate: mocks.startLocalGenerate,
  observeTaskUntilSettled: mocks.observeTaskUntilSettled,
  LOCAL_TASK_TIMEOUT_MS: 1000,
  WORKSHOP_BATCH_CONCURRENCY: 2,
}));
vi.mock("~/lib/workshop/generation-api-client", () => ({
  apiGenerateImage: mocks.apiGenerateImage,
}));
vi.mock("~/components/workshop/hooks/use-model-catalog", () => ({
  useModelCatalog: () => ({
    allCandidates: [],
    candidates: [],
    defaultMode: "T2I",
    loading: false,
    modeTabs: [],
    resolveCandidate: (value: string) => (value === "" ? null : { name: "local-model" }),
  }),
}));
vi.mock("~/components/ui/use-copy-feedback", () => ({
  useCopyFeedback: () => ({ copy: vi.fn() }),
}));

const presets: ReadonlyArray<ResearchPreset> = [
  {
    description: "第一件",
    id: "first",
    local: true,
    name: "甲",
    prompt: "first prompt",
    tags: ["甲"],
  },
  {
    description: "第二件",
    id: "second",
    local: true,
    name: "乙",
    prompt: "second prompt",
    tags: ["乙"],
  },
];

const config = {
  buildPrompt: (preset: ResearchPreset) => `prefix, ${preset.prompt}`,
  emptyHint: "先选一件",
  negative: () => "负向词",
  presets,
};

const mockedCancel = vi.mocked(cancelTask);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.buildLibraryWorkflowInput.mockResolvedValue({ input: { prompt: "x" } });
  mocks.startLocalGenerate.mockResolvedValueOnce("task-a").mockResolvedValueOnce("task-b");
  mocks.observeTaskUntilSettled.mockImplementation(() => vi.fn());
  mocks.apiGenerateImage.mockResolvedValue("https://example.test/a.png");
  mocks.cancelTask.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("useResearchLibrary（ISSUE #5125 / #5126）", () => {
  it("默认选中第一条，注入的提示词拼法逐条成行", () => {
    const { result } = renderHook(() => useResearchLibrary(config));
    expect(result.current.selectedIds).toEqual(["first"]);
    expect(result.current.prompt).toBe("prefix, first prompt");
    act(() => {
      result.current.togglePreset("second");
    });
    expect(result.current.prompt.split("\n")).toEqual([
      "prefix, first prompt",
      "prefix, second prompt",
    ]);
  });

  it("本地通道：逐条留 taskId，单条取消只打对应任务", async () => {
    const { result } = renderHook(() => useResearchLibrary(config));
    act(() => {
      result.current.togglePreset("second");
      result.current.setModelSelection({ mode: "T2I", model: "wf::1" });
    });
    act(() => {
      void result.current.generate();
    });
    await expect
      .poll(() => [result.current.results.first?.taskId, result.current.results.second?.taskId])
      .toEqual(["task-a", "task-b"]);

    await act(async () => {
      await result.current.cancelOne("first");
    });
    expect(mockedCancel).toHaveBeenCalledTimes(1);
    expect(mockedCancel).toHaveBeenCalledWith("task-a");
    expect(result.current.results.first?.status).toBe("cancelled");
    expect(result.current.results.second?.status).toBe("pending");
  });

  it("远端通道：结果留住库元数据，取消不产生请求", async () => {
    const { result } = renderHook(() => useResearchLibrary(config));
    act(() => {
      result.current.setModelSelection({ mode: "T2I", model: "remote-model" });
    });
    await act(async () => {
      await result.current.generate();
    });
    expect(mocks.apiGenerateImage).toHaveBeenCalledTimes(1);
    const done = result.current.results.first;
    expect(done?.taskId).toBeUndefined();
    expect(done?.modelName).toBe("local-model");
    expect(done?.negativePrompt).toBe("负向词");
    expect(done?.prompt).toBe("prefix, first prompt");
    expect(done?.status).toBe("done");
    expect(done?.url).toBe("https://example.test/a.png");

    await act(async () => {
      await result.current.cancelOne("first");
    });
    expect(mockedCancel).not.toHaveBeenCalled();
  });
});
