// @vitest-environment happy-dom
/**
 * 风格库逻辑层的行为契约（规范 11 §11.2）：本地工作流通道把 taskId 挂到结果上、
 * 单条取消真打到 cancelTask 并退订 SSE；远端通道没有 task 行，取消不动。
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cancelTask } from "~/lib/task-cancel-client";

import { useStyleLibrary } from "./use-style-library";

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
  createMutate: vi.fn(),
  observeTaskUntilSettled: vi.fn(),
  skillList: vi.fn(),
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
vi.mock("~/trpc/vanilla", () => ({
  vanillaApi: {
    skill: {
      create: { mutate: mocks.createMutate },
      list: { query: mocks.skillList },
    },
  },
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

const mockedCancel = vi.mocked(cancelTask);
const observers: Array<ObserverOptions> = [];
const disposers: Array<ReturnType<typeof vi.fn>> = [];

beforeEach(() => {
  vi.clearAllMocks();
  observers.length = 0;
  disposers.length = 0;
  mocks.skillList.mockResolvedValue({
    skills: [
      {
        description: "日系插画",
        name: "日系插画",
        promptTemplate: "anime style",
        slug: "anime-illustration",
        tags: ["动漫"],
      },
    ],
  });
  mocks.buildLibraryWorkflowInput.mockResolvedValue({ input: { prompt: "x" } });
  mocks.startLocalGenerate.mockResolvedValue("task-1");
  mocks.observeTaskUntilSettled.mockImplementation((options: ObserverOptions) => {
    observers.push(options);
    const dispose = vi.fn();
    disposers.push(dispose);
    return dispose;
  });
  mocks.apiGenerateImage.mockResolvedValue("https://example.test/remote.png");
  mocks.cancelTask.mockResolvedValue(undefined);
});

afterEach(cleanup);

async function setup(model: string) {
  const hook = renderHook(() => useStyleLibrary());
  await expect.poll(() => hook.result.current.styles.length).toBe(1);
  act(() => {
    hook.result.current.setUserPrompt("a girl");
    hook.result.current.setModelSelection({ mode: "T2I", model });
    hook.result.current.toggleStyle("anime-illustration");
  });
  return hook;
}

describe("useStyleLibrary 单条取消（ISSUE #5098）", () => {
  it("本地通道把 taskId 挂到结果上，取消时打 cancelTask、退订并落到已取消", async () => {
    const { result } = await setup("wf::wf-1");
    act(() => {
      void result.current.generate();
    });
    await expect.poll(() => result.current.results["anime-illustration"]?.taskId).toBe("task-1");
    expect(result.current.results["anime-illustration"]?.status).toBe("pending");

    await act(async () => {
      await result.current.cancelOne("anime-illustration");
    });
    expect(mockedCancel).toHaveBeenCalledWith("task-1");
    expect(disposers).toHaveLength(1);
    expect(disposers[0]).toHaveBeenCalledTimes(1);
    expect(result.current.results["anime-illustration"]?.status).toBe("cancelled");
    expect(result.current.results["anime-illustration"]?.taskId).toBe("task-1");
  });

  it("远端通道没有任务行：结果无 taskId，取消不产生任何请求", async () => {
    const { result } = await setup("remote-model");
    await act(async () => {
      await result.current.generate();
    });
    expect(mocks.apiGenerateImage).toHaveBeenCalledTimes(1);
    expect(result.current.results["anime-illustration"]?.status).toBe("done");
    expect(result.current.results["anime-illustration"]?.taskId).toBeUndefined();

    await act(async () => {
      await result.current.cancelOne("anime-illustration");
    });
    expect(mockedCancel).not.toHaveBeenCalled();
    expect(disposers).toHaveLength(0);
  });
});
