// 「测试模型能力」逻辑层行为（ISSUE #3995）：生成前（未点生成）请求详情面板
// 就要能同时看到「本地提交」与「实际请求」两部分 —— 此前预览请求缺 `kind`、
// 被中继路由按 400 拒掉，预览读数从未到达界面（`kind` 本身的补法已随 #3985
// 落在 master）。本文件锁：
// ① 预览请求按 `kind` 分流（第二参显式传，与真实发送同一条路由）；
// ② 生成前 previewRows 首行是「本地提交」行（relay 端点 + 统一输入），
//    后随服务端 dry-run 算出的「实际请求」行；
// ③ 未选模型时不发预览、也不给行；
// ④ 点生成后 debugRows 首行是本地提交行，结果落位（真实读数接棒）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type * as TanStackQuery from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiCallDebugRow } from "~/lib/workshop/api-channel-core";
import { isRecord } from "~/lib/is-record";
import type { TaskWatchHandlers, WorkshopWorkflowOption } from "~/lib/workshop/generation-client";

import { MODEL_TEST_DEFAULT_RESOLUTION, modeTabsForKind } from "../model-test-config";

import { useModelTest } from "./use-model-test";

/* 测试态（声明在 vi.mock 之前：工厂闭包在调用时才读它们）。 */
let configData: unknown;
let contractsData: unknown;
let adaptersByName: Record<string, unknown>;
let adaptersAll: unknown;
let upstreamPreview: Array<ApiCallDebugRow>;

const apiPreviewRequestMock =
  vi.fn<
    (body: Record<string, unknown>, kind: "image" | "video") => Promise<Array<ApiCallDebugRow>>
  >();
const apiGenerateImageMock =
  vi.fn<
    (
      req: unknown,
      opts?: { onDebug?: (rows: Array<ApiCallDebugRow>) => void; signal?: AbortSignal },
    ) => Promise<string>
  >();
/** tRPC mutation 的统一替身：对话测试（#4080）与外链打开都走它，按需给返回值。 */
const mutateAsyncSpy = vi.fn<(input: unknown) => Promise<unknown>>();

/* 工作流候选（#4080 评论 4）的测试态：fetchWorkshopWorkflows 的读数走 useQuery
 * 替身的 workshop 分支；本地通道的四个执行者各自给替身。 */
let workflowsData: Array<Record<string, unknown>>;
/** detailFull 替身读数（#4633 评论 2 闪烁修复）：缺省 = 已成功且无数据（组件
 *  回落通用默认，与既有用例同形）；`pending` = 查询进行中（组件不摆任何默认）；
 *  `data` = 已到位的工作流详情（组件播种工作流默认）；`failed` = 查询失败
 *  （组件回落通用默认）。 */
let detailFullState: { data?: unknown; failed?: boolean; pending?: boolean } = {};
const buildLibraryWorkflowInputMock =
  vi.fn<
    (
      workflowId: string,
      values: unknown,
      mode?: string | null,
      contractIds?: ReadonlyArray<string>,
    ) => Promise<unknown>
  >();
const startLocalGenerateMock = vi.fn<(input: unknown) => Promise<string>>();
const watchTaskMock = vi.fn<(taskId: string, handlers: TaskWatchHandlers) => () => void>();
const cancelLocalTaskMock = vi.fn<(taskId: string) => Promise<void>>();
const prepareLocalInputImageMock = vi.fn<(image: string) => Promise<string>>();

vi.mock("~/trpc/react", () => ({
  useTRPC: () => ({
    llm: {
      configGet: { queryOptions: () => ({ queryKey: ["llm", "configGet"] }) },
      modeContractsGet: { queryOptions: () => ({ queryKey: ["llm", "modeContractsGet"] }) },
      workshopAdaptersGet: {
        queryOptions: (input: { name: string }) => ({
          queryKey: ["llm", "workshopAdaptersGet", input.name],
        }),
      },
      chatTest: { mutationOptions: () => ({ mutationKey: ["llm", "chatTest"] }) },
    },
    setting: {
      openExternal: { mutationOptions: () => ({ mutationKey: ["setting", "openExternal"] }) },
    },
    workflow: {
      detailFull: {
        queryOptions: (input: { id: string }) => ({
          queryKey: ["workflow", "detailFull", input],
        }),
      },
    },
  }),
}));

vi.mock("~/lib/workshop/generation-client", () => ({
  apiGenerateImage: (
    req: unknown,
    opts?: { onDebug?: (rows: Array<ApiCallDebugRow>) => void; signal?: AbortSignal },
  ) => apiGenerateImageMock(req, opts),
  apiPollVideo: vi.fn(),
  apiPreviewRequest: (body: Record<string, unknown>, kind: "image" | "video") =>
    apiPreviewRequestMock(body, kind),
  apiSubmitVideo: vi.fn(),
  fetchWorkshopWorkflows: () => Promise.resolve(workflowsData),
  pollVideoUntilDone: vi.fn(),
  buildLibraryWorkflowInput: (
    workflowId: string,
    values: unknown,
    mode?: string | null,
    contractIds?: ReadonlyArray<string>,
  ) => buildLibraryWorkflowInputMock(workflowId, values, mode, contractIds),
  startLocalGenerate: (input: unknown) => startLocalGenerateMock(input),
  watchTask: (taskId: string, handlers: TaskWatchHandlers) => watchTaskMock(taskId, handlers),
  cancelLocalTask: (taskId: string) => cancelLocalTaskMock(taskId),
  prepareLocalInputImage: (image: string) => prepareLocalInputImageMock(image),
  /* workflow-model-test（真实实现）会读这个常量配超时安全阀。 */
  LOCAL_TASK_TIMEOUT_MS: 30 * 60 * 1000,
  WORKSHOP_BATCH_CONCURRENCY: 2,
}));

vi.mock("~/components/ui/use-busy-action", () => ({
  useBusyAction: () => ({
    busy: false,
    run: (fn: () => Promise<unknown>) => fn(),
  }),
}));

vi.mock("~/components/ui/use-external-action", () => ({
  useExternalAction: () => ({
    busy: false,
    runWithTarget: async (target: string, run: (t: string) => Promise<unknown>) => run(target),
  }),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof TanStackQuery>();
  return {
    ...actual,
    useQuery: (options: { queryKey: ReadonlyArray<unknown> }) => {
      const [ns, ep, name] = options.queryKey;
      if (ns === "llm" && ep === "configGet") {
        return { data: configData, isLoading: false };
      }
      if (ns === "workshop" && ep === "workflows") {
        return { data: workflowsData, isLoading: false };
      }
      if (ns === "llm" && ep === "modeContractsGet") {
        return { data: contractsData, isLoading: false };
      }
      if (ns === "llm" && ep === "workshopAdaptersGet") {
        return {
          data: typeof name === "string" ? adaptersByName[name] : undefined,
          isLoading: false,
        };
      }
      if (ns === "llm" && ep === "workshopAdaptersAll") {
        return { data: adaptersAll, isLoading: false };
      }
      if (ns === "workflow" && ep === "detailFull") {
        return {
          data: detailFullState.data,
          isError: detailFullState.failed === true,
          isLoading: detailFullState.pending === true,
          isSuccess: detailFullState.pending !== true && detailFullState.failed !== true,
        };
      }
      return { data: undefined, isError: false, isLoading: false, isSuccess: false };
    },
    useMutation: () => ({ mutateAsync: mutateAsyncSpy }),
  };
});

/** 独立 QueryClient + 替掉的 useQuery / useMutation。 */
function renderModelTest() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return renderHook(() => useModelTest(), { wrapper });
}

const UPSTREAM_ROW: ApiCallDebugRow = {
  body: { model: "agnes-image", prompt: "测试提示词" },
  durationMs: null,
  endpoint: "https://a/v1/images/generations",
  excerpt: null,
  ok: true,
  phase: "image",
  status: null,
};

beforeEach(() => {
  /* 预览有 600ms 去抖：整档走假定时器（等异步落定的合法形态之一）。 */
  vi.useFakeTimers();
  configData = {
    config: {
      extraModels: [{ baseUrl: "https://a/v1", kind: "image", name: "agnes-image" }],
    },
  };
  contractsData = { contracts: [] };
  adaptersByName = {};
  workflowsData = [];
  detailFullState = {};
  /* 适配器索引给上该模型的 T2I 条目：索引已加载且模型支持默认模式，
   * 候选不会被「按模式收窄」滤空。 */
  adaptersAll = { "agnes-image": [{ mode: "T2I" }] };
  upstreamPreview = [];
  apiPreviewRequestMock.mockReset();
  apiGenerateImageMock.mockReset();
  mutateAsyncSpy.mockReset();
  buildLibraryWorkflowInputMock.mockReset();
  startLocalGenerateMock.mockReset();
  watchTaskMock.mockReset();
  cancelLocalTaskMock.mockReset();
  prepareLocalInputImageMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useModelTest：生成前的请求预览（ISSUE #3995）", () => {
  it("选中模型、未点生成：requestRows 首行是本地提交行、后随实际请求行，预览请求带 kind", async () => {
    upstreamPreview = [UPSTREAM_ROW];
    apiPreviewRequestMock.mockResolvedValue(upstreamPreview);
    const { result } = renderModelTest();
    expect(result.current.candidates).toHaveLength(1);

    act(() => {
      result.current.selectModel("agnes-image");
    });
    act(() => {
      result.current.patchValue("prompt", "测试提示词");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    /* 预览请求与真实发送同一条路由：kind 走第二参显式分流（缺它路由 400）。 */
    expect(apiPreviewRequestMock).toHaveBeenCalledTimes(1);
    expect(apiPreviewRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "T2I",
        model: "agnes-image",
        prompt: "测试提示词",
      }),
      "image",
    );

    /* 面板读数：首行本地提交（relay 端点 + 统一输入），后随实际上游请求。 */
    expect(result.current.requestRows).toHaveLength(2);
    const localRow = result.current.requestRows[0];
    expect(localRow?.phase).toBe("relay");
    expect(localRow?.endpoint).toBe("/api/workshop-api/generate");
    expect(localRow?.body).toMatchObject({
      kind: "image",
      mode: "T2I",
      model: "agnes-image",
      prompt: "测试提示词",
    });
    expect(result.current.requestRows[1]).toEqual(UPSTREAM_ROW);
  });

  it("未选模型：不发预览请求，也不给预览行", async () => {
    const { result } = renderModelTest();
    act(() => {
      result.current.patchValue("prompt", "测试提示词");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(apiPreviewRequestMock).not.toHaveBeenCalled();
    expect(result.current.requestRows).toEqual([]);
  });

  it("点生成：请求行保留（本地提交），真实读数进响应区（#4080 评论 13）", async () => {
    apiGenerateImageMock.mockImplementation(
      (
        _req: unknown,
        opts?: { onDebug?: (rows: Array<ApiCallDebugRow>) => void; signal?: AbortSignal },
      ) => {
        opts?.onDebug?.([UPSTREAM_ROW]);
        return Promise.resolve("https://img.example/x.png");
      },
    );
    const { result } = renderModelTest();

    act(() => {
      result.current.selectModel("agnes-image");
    });
    act(() => {
      result.current.patchValue("prompt", "测试提示词");
    });
    await act(async () => {
      await result.current.generate();
    });

    expect(apiGenerateImageMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "T2I", model: "agnes-image", prompt: "测试提示词" }),
      expect.anything(),
    );
    expect(result.current.result).toEqual({ kind: "image", url: "https://img.example/x.png" });
    expect(result.current.generating).toBe(false);
    /* 请求行保留（本地提交行还在），真实读数单独进响应区（#4080 评论 13）。 */
    expect(result.current.requestRows).toHaveLength(1);
    const localRow = result.current.requestRows[0];
    expect(localRow?.phase).toBe("relay");
    expect(localRow?.endpoint).toBe("/api/workshop-api/generate");
    expect(localRow?.body).toMatchObject({ kind: "image", prompt: "测试提示词" });
    expect(result.current.responseRows).toHaveLength(1);
    expect(result.current.responseRows[0]).toEqual(UPSTREAM_ROW);
  });
});

describe("useModelTest：本地模型与对话测试（ISSUE #4080）", () => {
  it("本地 Ollama 候选（extraModels 字符串条目）按 local 解析，只在对话用途出现", () => {
    configData = {
      config: {
        extraModels: ["qwen3-8b", { baseUrl: "https://a/v1", kind: "image", name: "agnes-image" }],
      },
    };
    const { result } = renderModelTest();
    /* 图片用途：本地候选不出现（Ollama 不做生图），远端按 kind 命中。 */
    expect(result.current.candidates.map((c) => c.name)).toEqual(["agnes-image"]);

    act(() => {
      result.current.setKind("chat");
    });
    /* 对话用途：本地候选进来（无模式维度、不做收窄），带 local 标记。 */
    expect(result.current.candidates).toEqual([
      { name: "qwen3-8b", kind: "chat", baseUrl: null, local: true },
    ]);
  });

  it("对话测试：点发送走 llm.chatTest，产物是回复文本，请求详情带端点与耗时", async () => {
    configData = { config: { extraModels: ["qwen3-8b"] } };
    mutateAsyncSpy.mockResolvedValue({
      reply: "pong",
      durationMs: 1234,
      endpoint: "http://127.0.0.1:11434/v1/chat/completions",
      model: "qwen3-8b",
    });
    const { result } = renderModelTest();

    act(() => {
      result.current.setKind("chat");
    });
    act(() => {
      result.current.selectModel("qwen3-8b");
    });
    act(() => {
      result.current.patchValue("prompt", "ping");
    });
    await act(async () => {
      await result.current.generate();
    });

    expect(mutateAsyncSpy).toHaveBeenCalledWith({
      name: "qwen3-8b",
      local: true,
      prompt: "ping",
    });
    expect(result.current.result).toEqual({ kind: "chat", text: "pong" });
    expect(result.current.generating).toBe(false);
    /* 请求行保留（对话的本地提交预览），真实读数单独进响应区（#4080 评论 13）。 */
    expect(result.current.requestRows).toHaveLength(1);
    expect(result.current.requestRows[0]?.body).toMatchObject({
      kind: "chat",
      model: "qwen3-8b",
      prompt: "ping",
    });
    expect(result.current.responseRows).toHaveLength(1);
    const chatRow = result.current.responseRows[0];
    expect(chatRow?.endpoint).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(chatRow?.durationMs).toBe(1234);
    expect(chatRow?.excerpt).toBe("pong");
    expect(chatRow?.body).toMatchObject({ kind: "chat", model: "qwen3-8b", prompt: "ping" });
  });
});

/* 对话候选的「当前生效主模型」兜底（ISSUE #4823）：设置页把主模型排除在
 * extraModels 外（播种过滤 + 保存不并回），测试页此前只读 extraModels ——
 * 只设了主模型、没勾候选的单模型 Ollama 配置在对话页签永远空态，而工坊
 * 文本下拉有兜底能看到它。判据是共享纯函数（chatFallbackGroupForCurrentModel），
 * 这里锁测试页消费侧的行为：归组、发送通道与去重。 */
describe("useModelTest：对话候选的主模型兜底（ISSUE #4823）", () => {
  it("只设主模型、没勾候选的单模型 Ollama：对话页签仍能看到本地候选", () => {
    configData = {
      config: {
        model: "qwen3:14b",
        provider: "local",
        baseUrl: "http://127.0.0.1:11434/v1",
        extraModels: [],
      },
    };
    const { result } = renderModelTest();
    act(() => {
      result.current.setKind("chat");
    });
    expect(result.current.candidates).toEqual([
      { name: "qwen3:14b", kind: "chat", baseUrl: null, local: true },
    ]);
    expect(result.current.kindCandidateCount).toBe(1);
  });

  it("误存成远端的主模型（回环 + 无密钥）按生效提供方归本地组", () => {
    configData = {
      config: {
        model: "qwen3:14b",
        provider: "remote",
        baseUrl: "http://127.0.0.1:11434/v1",
        hasApiKey: false,
        extraModels: [],
      },
    };
    const { result } = renderModelTest();
    act(() => {
      result.current.setKind("chat");
    });
    expect(result.current.candidates).toEqual([
      { name: "qwen3:14b", kind: "chat", baseUrl: null, local: true },
    ]);
  });

  it("真远端主模型归远端组：候选带地址，点发送走 llm.chatTest 且 local:false", async () => {
    configData = {
      config: {
        model: "gpt-x",
        provider: "remote",
        baseUrl: "https://api.x.com/v1",
        extraModels: [],
      },
    };
    mutateAsyncSpy.mockResolvedValue({
      reply: "pong",
      durationMs: 5,
      endpoint: "https://api.x.com/v1/chat/completions",
      model: "gpt-x",
    });
    const { result } = renderModelTest();
    act(() => {
      result.current.setKind("chat");
    });
    expect(result.current.candidates).toEqual([
      { name: "gpt-x", kind: "chat", baseUrl: "https://api.x.com/v1", local: false },
    ]);
    act(() => {
      result.current.selectModel("gpt-x");
    });
    act(() => {
      result.current.patchValue("prompt", "ping");
    });
    await act(async () => {
      await result.current.generate();
    });
    expect(mutateAsyncSpy).toHaveBeenCalledWith({ name: "gpt-x", local: false, prompt: "ping" });
    expect(result.current.result).toEqual({ kind: "chat", text: "pong" });
  });

  it("主模型已在候选清单里时不重复兜底；远端 image 用途的主模型不进对话", () => {
    configData = {
      config: {
        model: "qwen3-8b",
        provider: "local",
        extraModels: ["qwen3-8b"],
      },
    };
    const { result } = renderModelTest();
    act(() => {
      result.current.setKind("chat");
    });
    expect(result.current.candidates).toEqual([
      { name: "qwen3-8b", kind: "chat", baseUrl: null, local: true },
    ]);

    configData = {
      config: {
        model: "agnes-image",
        provider: "remote",
        baseUrl: "https://a/v1",
        extraModels: [{ name: "agnes-image", kind: "image", baseUrl: "https://a/v1" }],
      },
    };
    const rerendered = renderModelTest();
    act(() => {
      rerendered.result.current.setKind("chat");
    });
    expect(rerendered.result.current.candidates).toEqual([]);
    expect(rerendered.result.current.kindCandidateCount).toBe(0);
  });
});

/* 工作流提供的图片/视频模型（ISSUE #4080 评论 4）：工作流库条目作为「本地模型」
 * 的第二种形态进测试页，走工坊本地 ComfyUI 通道测试。 */
describe("useModelTest：工作流提供的图片/视频模型（ISSUE #4080 评论 4）", () => {
  const WF_IMAGE: WorkshopWorkflowOption = {
    id: "wf-1",
    name: "工作流·生图A",
    category: "image",
    modes: ["T2I"],
    taskType: "T2I",
    modelTags: [],
    encapsulationReady: true,
  };

  it("工作流候选作为本地候选进入图片/视频用途，对话用途不出现", () => {
    workflowsData = [
      WF_IMAGE,
      {
        ...WF_IMAGE,
        id: "wf-2",
        name: "工作流·视频B",
        category: "video",
        modes: ["T2V"],
        taskType: "T2V",
      },
    ];
    configData = {
      config: {
        extraModels: ["qwen3-8b", { baseUrl: "https://a/v1", kind: "image", name: "agnes-image" }],
      },
    };
    const { result } = renderModelTest();
    /* 图片用途：远端按 kind 命中 + 工作流候选（本地）。 */
    expect(result.current.candidates.map((c) => c.name)).toEqual(["agnes-image", "工作流·生图A"]);
    const wf = result.current.candidates[1];
    expect(wf?.local).toBe(true);
    expect(wf?.workflow?.id).toBe("wf-1");
    /* 对话用途：只有 Ollama 候选，工作流不进来（工作流不做对话）。 */
    act(() => {
      result.current.setKind("chat");
    });
    expect(result.current.candidates.map((c) => c.name)).toEqual(["qwen3-8b"]);
    /* 视频用途：只有视频类工作流（远端 image 条目被 kind 过滤掉）。 */
    act(() => {
      result.current.setKind("video");
    });
    expect(result.current.candidates.map((c) => c.name)).toEqual(["工作流·视频B"]);
  });

  it("工作流候选按 modes 声明做模式收窄，选中后切到不支持的模式会清空选择", () => {
    workflowsData = [WF_IMAGE];
    const { result } = renderModelTest();
    expect(result.current.candidates).toHaveLength(2);
    act(() => {
      result.current.setMode("I2I");
    });
    /* agnes-image 没配 I2I 适配器、工作流只声明了 T2I —— 都被收窄掉。 */
    expect(result.current.candidates).toHaveLength(0);
    act(() => {
      result.current.selectModel("wf::wf-1");
    });
    act(() => {
      result.current.setMode("I2I");
    });
    /* 选中工作流后切到不支持的模式：按 modes 判支持并清掉选择。 */
    expect(result.current.selectedModel).toBe("");
  });

  it("modeTabsForKind 的页签徽标计入工作流候选", () => {
    const tabs = modeTabsForKind("image", {}, [WF_IMAGE]);
    expect(tabs.find((t) => t.mode === "T2I")?.modelCount).toBe(1);
    expect(tabs.find((t) => t.mode === "I2I")?.modelCount).toBe(0);
  });

  it("未封装的工作流点生成被拦下，不发起本地任务", async () => {
    workflowsData = [{ ...WF_IMAGE, encapsulationReady: false }];
    const { result } = renderModelTest();
    act(() => {
      result.current.selectModel("wf::wf-1");
    });
    act(() => {
      result.current.patchValue("prompt", "测试提示词");
    });
    await act(async () => {
      await result.current.generate();
    });
    expect(result.current.error).toContain("工坊封装");
    expect(startLocalGenerateMock).not.toHaveBeenCalled();
  });

  it("点生成走本地 ComfyUI 通道：封装 → 入队 → 观察，产物落位", async () => {
    workflowsData = [WF_IMAGE];
    buildLibraryWorkflowInputMock.mockResolvedValue({
      input: {
        workflow: "wf-1",
        prompt: "测试提示词",
        /* 尺寸等落进端口的输入随提交体逐条可见（#4080 评论 8）。 */
        workflowInputs: [{ name: "width", nodeId: "5", value: 832 }],
      },
      unmatched: [],
      mode: "T2I",
      modes: ["T2I"],
      usesFirstFrame: false,
      usesLastFrame: false,
    });
    startLocalGenerateMock.mockResolvedValue("task-abcd1234");
    watchTaskMock.mockImplementation((_taskId: string, handlers: TaskWatchHandlers) => {
      handlers.onLog?.({ t: Date.now(), level: "info", msg: "[watchTask] 已订阅 SSE" });
      handlers.onOutput?.({ kind: "image", url: "http://local/preview.png" });
      handlers.onSettled?.({ ok: true });
      return () => undefined;
    });
    const { result } = renderModelTest();
    act(() => {
      result.current.selectModel("wf::wf-1");
    });
    act(() => {
      result.current.patchValue("prompt", "测试提示词");
    });
    await act(async () => {
      await result.current.generate();
    });

    expect(buildLibraryWorkflowInputMock).toHaveBeenCalledWith(
      "wf-1",
      expect.objectContaining({ prompt: "测试提示词" }),
      "T2I",
      undefined,
    );
    expect(startLocalGenerateMock).toHaveBeenCalledTimes(1);
    expect(result.current.result).toEqual({ kind: "image", url: "http://local/preview.png" });
    expect(result.current.generating).toBe(false);
    /* 请求行（本地提交，带落点清单）与响应行（本地任务）分区（#4080 评论 13）。 */
    expect(result.current.requestRows).toHaveLength(1);
    expect(result.current.requestRows[0]?.phase).toBe("relay");
    expect(result.current.requestRows[0]?.endpoint).toBe("generate.generate（本地 ComfyUI）");
    /* 提交体带完整的落点清单（口 → 节点 → 值），尺寸等不再只见条数（#4080 评论 8）。 */
    expect(result.current.requestRows[0]?.body).toMatchObject({
      workflowInputs: [{ name: "width", nodeId: "5", value: 832 }],
    });
    expect(result.current.responseRows).toHaveLength(1);
    expect(result.current.responseRows[0]?.phase).toBe("local-task");
    expect(result.current.responseRows[0]?.excerpt).toBe("http://local/preview.png");
    /* 执行日志随 SSE log 帧进 taskLogs（#4080 评论 8）。 */
    expect(result.current.taskLogs.length).toBeGreaterThan(0);
    expect(result.current.taskLogs[0]?.msg).toContain("已订阅 SSE");
  });

  it("打开相对路径产物：传给 openExternal 的是 origin + 路径的绝对 URL（#4750）", async () => {
    /* 本地工作流产物是 /api/generated/<task>/<file>（相对路径）；openExternal 入参是
     * z.url()，直接传会 invalid_format。openResultInBrowser 必须先补 origin。 */
    const relative = "/api/generated/task-abcd/img_0.png";
    mutateAsyncSpy.mockResolvedValue({ ok: true, detail: "" });
    const { result } = renderModelTest();
    await act(async () => {
      await result.current.openResultInBrowser(relative);
    });
    expect(mutateAsyncSpy).toHaveBeenCalledTimes(1);
    expect(mutateAsyncSpy).toHaveBeenCalledWith({
      url: new URL(relative, window.location.origin).toString(),
    });
  });

  it("打开已是绝对地址的产物：原样交给 openExternal，不改 host（#4750）", async () => {
    const absolute = "https://cdn.example.com/clip.mp4";
    mutateAsyncSpy.mockResolvedValue({ ok: true, detail: "" });
    const { result } = renderModelTest();
    await act(async () => {
      await result.current.openResultInBrowser(absolute);
    });
    expect(mutateAsyncSpy).toHaveBeenCalledWith({ url: absolute });
  });

  it("生成前的本地提交预览行带尺寸等非空表单值（#4080 评论 8）", () => {
    workflowsData = [WF_IMAGE];
    const { result } = renderModelTest();
    act(() => {
      result.current.selectModel("wf::wf-1");
    });
    /* selectModel 已按最常用档预置尺寸（1:1 + 1k）—— 预览行里原样可见。 */
    expect(result.current.requestRows).toHaveLength(1);
    expect(result.current.requestRows[0]?.endpoint).toBe("generate.generate（本地 ComfyUI）");
    expect(result.current.requestRows[0]?.body).toMatchObject({
      workflow: "工作流·生图A",
      mode: "T2I",
      "aspect-ratio": "1:1",
      resolution: MODEL_TEST_DEFAULT_RESOLUTION,
    });
  });

  it("工作流详情未到时不摆通用默认，到了再一次性播工作流默认（#4633 评论 2 闪烁）", () => {
    workflowsData = [WF_IMAGE];
    detailFullState = { pending: true };
    const { result, rerender } = renderModelTest();
    act(() => {
      result.current.selectModel("wf::wf-1");
    });
    /* 查询进行中：表单不先摆「1:1 / 1k」，详情到达后不再跳一次（不闪）。 */
    expect(result.current.values).toEqual({});

    /* 详情到位：一次性播工作流在所选模式下的端口默认值（模式覆盖层生效）；
     * 工作流用「百万像素 + 倍数」表达尺寸时通用分辨率档清空。 */
    detailFullState = {
      data: {
        paramMap: {
          source: {
            "mode:T2I": {
              "size-aspect": "7::widget::aspect_ratio",
              "size-megapixels": "7::widget::megapixels",
              "size-multiple": "7::widget::multiple",
            },
          },
        },
        workflowIO: {
          "7::widget::aspect_ratio": {
            defaultValue: "16:9 (Widescreen)",
            direction: "input",
            kind: "widget",
            label: "aspect_ratio",
            name: "aspect_ratio",
            nodeId: "7",
            type: "COMBO",
          },
          "7::widget::megapixels": {
            defaultValue: 4,
            direction: "input",
            kind: "widget",
            label: "megapixels",
            name: "megapixels",
            nodeId: "7",
            type: "INT",
          },
          "7::widget::multiple": {
            defaultValue: 32,
            direction: "input",
            kind: "widget",
            label: "multiple",
            name: "multiple",
            nodeId: "7",
            type: "INT",
          },
        },
      },
    };
    rerender();
    expect(result.current.values).toMatchObject({
      "aspect-ratio": "16:9",
      megapixels: "4",
      multiple: "32",
      resolution: "",
    });
  });

  it("工作流详情查询失败也回落通用默认（表单不至于永远空着）（#4633 评论 2）", () => {
    workflowsData = [WF_IMAGE];
    detailFullState = { failed: true };
    const { result } = renderModelTest();
    act(() => {
      result.current.selectModel("wf::wf-1");
    });
    expect(result.current.values).toMatchObject({
      "aspect-ratio": "1:1",
      resolution: MODEL_TEST_DEFAULT_RESOLUTION,
    });
  });

  it("工作流候选显示模型名（模型标签）而非工作流名；同标签多工作流用工作流名消歧（#4080 评论 17）", () => {
    workflowsData = [
      { ...WF_IMAGE, name: "image_z_image_int8_t2i", modelTags: ["z-image"] },
      { ...WF_IMAGE, id: "wf-3", name: "image_z_image_v2", modelTags: ["z-image"] },
      { ...WF_IMAGE, id: "wf-4", name: "image_no_tag", modelTags: [] },
    ];
    const { result } = renderModelTest();
    /* 下拉显示名：模型标签优先；同标签多工作流用工作流名消歧；无标签退工作流名。 */
    expect(result.current.candidateLabels).toEqual({
      "agnes-image": "agnes-image",
      "wf::wf-1": "z-image",
      "wf::wf-3": "z-image · image_z_image_v2",
      "wf::wf-4": "image_no_tag",
    });
  });

  it("切换模型保留各自已填参数（#4080 评论 19）", () => {
    workflowsData = [
      WF_IMAGE,
      { ...WF_IMAGE, id: "wf-2", name: "工作流·生图B", modelTags: ["b-image"] },
    ];
    const { result } = renderModelTest();
    act(() => {
      result.current.selectModel("wf::wf-1");
    });
    act(() => {
      result.current.patchValue("prompt", "甲模型的提示词");
    });
    act(() => {
      result.current.selectModel("wf::wf-2");
    });
    /* 切到 B：B 是新格，参数是该模式的默认档（提示词为空）。 */
    expect(result.current.values.prompt ?? "").toBe("");
    act(() => {
      result.current.patchValue("prompt", "乙模型的提示词");
    });
    /* 切回 A：A 已填的参数原样保留（#4080 评论 19）。 */
    act(() => {
      result.current.selectModel("wf::wf-1");
    });
    expect(result.current.values.prompt).toBe("甲模型的提示词");
    act(() => {
      result.current.selectModel("wf::wf-2");
    });
    expect(result.current.values.prompt).toBe("乙模型的提示词");
  });

  it("切走模型后，已完模型的响应读数不串格（#4080 评论 12/19）", async () => {
    workflowsData = [WF_IMAGE];
    apiGenerateImageMock.mockImplementation((_req, opts) => {
      opts?.onDebug?.([UPSTREAM_ROW]);
      return Promise.resolve("https://img.example/x.png");
    });
    const { result } = renderModelTest();
    act(() => {
      result.current.selectModel("agnes-image");
    });
    act(() => {
      result.current.patchValue("prompt", "测试提示词");
    });
    await act(async () => {
      await result.current.generate();
    });
    expect(result.current.responseRows).toHaveLength(1);
    /* 切到另一格：那一格没有 A 的响应读数（按格隔离）。 */
    act(() => {
      result.current.selectModel("wf::wf-1");
    });
    expect(result.current.responseRows).toEqual([]);
  });

  it("取消生成：中止本地任务并取消服务端任务（#4080 评论 12 回归）", async () => {
    workflowsData = [WF_IMAGE];
    buildLibraryWorkflowInputMock.mockResolvedValue({
      input: { workflow: "wf-1", prompt: "测试提示词", workflowInputs: [] },
      unmatched: [],
      mode: "T2I",
      modes: ["T2I"],
      usesFirstFrame: false,
      usesLastFrame: false,
    });
    startLocalGenerateMock.mockResolvedValue("task-abcd1234");
    cancelLocalTaskMock.mockResolvedValue(undefined);
    /* 任务不落定：停在等 SSE 的状态，等取消来救。 */
    watchTaskMock.mockImplementation(() => () => undefined);
    const { result } = renderModelTest();
    act(() => {
      result.current.selectModel("wf::wf-1");
    });
    act(() => {
      result.current.patchValue("prompt", "测试提示词");
    });
    void result.current.generate();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      result.current.cancelGenerate();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.error).toBe("已取消生成");
    expect(result.current.generating).toBe(false);
    expect(cancelLocalTaskMock).toHaveBeenCalledWith("task-abcd1234");
  });

  it("不同模型可同时测试：第二格的生成不被第一格拦下（#4080 评论 12）", async () => {
    workflowsData = [
      WF_IMAGE,
      { ...WF_IMAGE, id: "wf-2", name: "工作流·生图B", modes: ["T2I"], taskType: "T2I" },
    ];
    /* 按请求的工作流 id 区分任务号：两格并发的断言才分得出彼此。 */
    buildLibraryWorkflowInputMock.mockImplementation((id: string) =>
      Promise.resolve({
        input: { workflow: id, prompt: "x", workflowInputs: [] },
        unmatched: [],
        mode: "T2I",
        modes: ["T2I"],
        usesFirstFrame: false,
        usesLastFrame: false,
      }),
    );
    startLocalGenerateMock.mockImplementation((input: unknown) =>
      Promise.resolve(isRecord(input) && input.workflow === "wf-1" ? "task-1" : "task-2"),
    );
    cancelLocalTaskMock.mockResolvedValue(undefined);
    /* 任务不落定：停在等 SSE 的状态。 */
    watchTaskMock.mockImplementation(() => () => undefined);
    const { result } = renderModelTest();
    act(() => {
      result.current.selectModel("wf::wf-1");
    });
    act(() => {
      result.current.patchValue("prompt", "x");
    });
    void result.current.generate();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(startLocalGenerateMock).toHaveBeenCalledTimes(1);
    /* 切到另一个模型再发起：不被第一格的重入闸门拦下（可同时测试）。 */
    act(() => {
      result.current.selectModel("wf::wf-2");
    });
    act(() => {
      result.current.patchValue("prompt", "y");
    });
    void result.current.generate();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(startLocalGenerateMock).toHaveBeenCalledTimes(2);
    expect(cancelLocalTaskMock).not.toHaveBeenCalled();
    /* 收尾：取消两格，让挂起的 promise 落定（不留悬挂任务）。 */
    act(() => {
      result.current.cancelGenerate("image::T2I::wf::wf-1");
      result.current.cancelGenerate("image::T2I::wf::wf-2");
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(cancelLocalTaskMock).toHaveBeenCalledWith("task-1");
    expect(cancelLocalTaskMock).toHaveBeenCalledWith("task-2");
  });
});

describe("useModelTest：JSON 输入模式（ISSUE #4769）", () => {
  it("applyJsonValues：合法载荷写回当前格表单值（认识的键才写）", () => {
    const { result } = renderModelTest();
    act(() => {
      result.current.selectModel("agnes-image");
    });
    let res: ReturnType<typeof result.current.applyJsonValues> | undefined;
    act(() => {
      res = result.current.applyJsonValues(
        JSON.stringify({
          mode: "T2I",
          inputs: {
            prompt: "历史那次的提示词",
            seed: "731030653625918",
            "aspect-ratio": "1:1 (Square)",
            "not-a-type": "应被忽略",
          },
        }),
      );
    });
    expect(res?.ok).toBe(true);
    /* 不用 expect.objectContaining（它返回 any，撞 no-unsafe-assignment）：
       先取 ok 侧的 values，再逐键断言。 */
    const applied = res?.ok === true ? res.values : undefined;
    expect(applied?.prompt).toBe("历史那次的提示词");
    expect(applied?.seed).toBe("731030653625918");
    expect(applied?.["aspect-ratio"]).toBe("1:1 (Square)");
    expect(result.current.values.prompt).toBe("历史那次的提示词");
    expect(result.current.values.seed).toBe("731030653625918");
    /* 认不得的键不进表单值（类型收窄在 controller，视图不吃脏键）。 */
    expect("not-a-type" in result.current.values).toBe(false);
  });

  it("applyJsonValues：非法 JSON / 缺 inputs → ok:false，错误落当前格反馈位，表单不动", () => {
    const { result } = renderModelTest();
    act(() => {
      result.current.selectModel("agnes-image");
    });
    act(() => {
      result.current.patchValue("prompt", "原有提示词");
    });
    for (const bad of ["不是 JSON", '{"mode":"T2I"}', '{"inputs":"不是对象"}', "[1,2]"]) {
      let res: ReturnType<typeof result.current.applyJsonValues> | undefined;
      act(() => {
        res = result.current.applyJsonValues(bad);
      });
      expect(res?.ok, `载荷 ${bad} 应被拒`).toBe(false);
      expect(result.current.error ?? "").not.toBe("");
    }
    /* 表单值未被任何一次失败污染。 */
    expect(result.current.values.prompt).toBe("原有提示词");
    expect(result.current.error).toContain("JSON");
  });

  it("generate 带覆盖值：JSON 解析出的值在同一次点击里进真实请求（不吃旧闭包）", async () => {
    apiGenerateImageMock.mockImplementation(
      (
        _req: unknown,
        opts?: { onDebug?: (rows: Array<ApiCallDebugRow>) => void; signal?: AbortSignal },
      ) => {
        opts?.onDebug?.([UPSTREAM_ROW]);
        return Promise.resolve("https://img.example/x.png");
      },
    );
    const { result } = renderModelTest();
    act(() => {
      result.current.selectModel("agnes-image");
    });
    /* 没先 patchValue：提示词只存在于解析结果里。覆盖值随 generate 显式给 ——
       这正是 JSON 模式「粘贴后同一次点击重跑」的通路。 */
    let values: Record<string, string> = {};
    act(() => {
      const res = result.current.applyJsonValues(
        JSON.stringify({ mode: "T2I", inputs: { prompt: "历史那次的提示词", seed: "42" } }),
      );
      if (res.ok) {
        values = res.values;
      }
    });
    await act(async () => {
      await result.current.generate(undefined, values);
    });
    expect(apiGenerateImageMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "T2I", model: "agnes-image", prompt: "历史那次的提示词" }),
      expect.anything(),
    );
    expect(result.current.result).toEqual({ kind: "image", url: "https://img.example/x.png" });
  });

  it("applyJsonValues 失败（缺提示词等必备口）不会发起生成", async () => {
    apiGenerateImageMock.mockClear();
    const { result } = renderModelTest();
    act(() => {
      result.current.selectModel("agnes-image");
    });
    let values: Record<string, string> = {};
    act(() => {
      const res = result.current.applyJsonValues(
        JSON.stringify({ mode: "T2I", inputs: { seed: "42" } }),
      );
      if (res.ok) {
        values = res.values;
      }
    });
    await act(async () => {
      await result.current.generate(undefined, values);
    });
    /* 契约必备口（提示词）缺失被拦，生成不发起。 */
    expect(apiGenerateImageMock).not.toHaveBeenCalled();
    expect(result.current.error).toContain("提示词");
  });
});
