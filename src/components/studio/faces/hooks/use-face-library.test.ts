// @vitest-environment happy-dom
/**
 * 脸库逻辑层的行为契约（规范 11 §11.2）：默认选中一张、可多选批量入选；
 * 本地通道把 taskId 挂到逐脸结果上，单条取消退订并落到已取消；远端通道不产生取消。
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cancelTask } from "~/lib/task-cancel-client";

import { useFaceLibrary } from "./use-face-library";

type ObserverOptions = {
  onIdleTimeout: (snapshot: unknown) => void;
  onOutput: (out: unknown) => void;
  onSettled: (result: { message?: string; ok: boolean }) => void;
  taskId: string;
  timeoutMs: number;
};

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

const mockedCancel = vi.mocked(cancelTask);
const disposers: Array<ReturnType<typeof vi.fn>> = [];

beforeEach(() => {
  vi.clearAllMocks();
  disposers.length = 0;
  mocks.buildLibraryWorkflowInput.mockResolvedValue({ input: { prompt: "x" } });
  mocks.startLocalGenerate.mockResolvedValue("task-face");
  mocks.observeTaskUntilSettled.mockImplementation((_options: ObserverOptions) => {
    const dispose = vi.fn();
    disposers.push(dispose);
    return dispose;
  });
  mocks.apiGenerateImage.mockResolvedValue("https://example.test/face.png");
  mocks.cancelTask.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("useFaceLibrary 多选与单条取消（ISSUE #5098）", () => {
  it("默认选中一张，勾选/清空后可批量入选", () => {
    const { result } = renderHook(() => useFaceLibrary());
    expect(result.current.selectedIds).toHaveLength(1);
    expect(result.current.selectedIds[0]).toBe("silver-mage");

    act(() => {
      result.current.toggleFace("black-swordsman");
    });
    expect(result.current.selectedIds).toEqual(["silver-mage", "black-swordsman"]);
    expect(result.current.selectedPresets.map((preset) => preset.id)).toEqual([
      "silver-mage",
      "black-swordsman",
    ]);
    expect(result.current.prompt.split("\n")).toHaveLength(2);

    act(() => {
      result.current.clearAll();
    });
    expect(result.current.selectedIds).toEqual([]);
    act(() => {
      result.current.selectAll();
    });
    expect(result.current.selectedIds.length).toBeGreaterThan(2);
  });

  it("本地通道：两张脸各带 taskId，单条取消只打对应任务并退订", async () => {
    mocks.startLocalGenerate.mockResolvedValueOnce("task-a").mockResolvedValueOnce("task-b");
    const { result } = renderHook(() => useFaceLibrary());
    act(() => {
      result.current.toggleFace("black-swordsman");
      result.current.setModelSelection({ mode: "T2I", model: "wf::wf-1" });
    });

    act(() => {
      void result.current.generate();
    });
    await expect
      .poll(() => [
        result.current.results["silver-mage"]?.taskId,
        result.current.results["black-swordsman"]?.taskId,
      ])
      .toEqual(["task-a", "task-b"]);

    await act(async () => {
      await result.current.cancelOne("silver-mage");
    });
    expect(mockedCancel).toHaveBeenCalledTimes(1);
    expect(mockedCancel).toHaveBeenCalledWith("task-a");
    expect(disposers).toHaveLength(2);
    expect(disposers[0]).toHaveBeenCalledTimes(1);
    expect(disposers[1]).not.toHaveBeenCalled();
    expect(result.current.results["silver-mage"]?.status).toBe("cancelled");
    expect(result.current.results["black-swordsman"]?.status).toBe("pending");
  });

  it("远端通道：结果无 taskId，取消不产生请求", async () => {
    const { result } = renderHook(() => useFaceLibrary());
    act(() => {
      result.current.setModelSelection({ mode: "T2I", model: "remote-model" });
    });
    await act(async () => {
      await result.current.generate();
    });
    expect(mocks.apiGenerateImage).toHaveBeenCalledTimes(1);
    expect(result.current.results["silver-mage"]?.taskId).toBeUndefined();

    await act(async () => {
      await result.current.cancelOne("silver-mage");
    });
    expect(mockedCancel).not.toHaveBeenCalled();
  });
});
