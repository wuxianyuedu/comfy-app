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
const apiGenerateImageMock = vi.fn<(req: unknown) => Promise<string>>();
/** tRPC mutation 的统一替身：对话测试（#4080）与外链打开都走它，按需给返回值。 */
const mutateAsyncSpy = vi.fn<(input: unknown) => Promise<unknown>>();

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
  }),
}));

vi.mock("~/lib/workshop/generation-client", () => ({
  apiGenerateImage: (req: unknown) => apiGenerateImageMock(req),
  apiPollVideo: vi.fn(),
  apiPreviewRequest: (body: Record<string, unknown>, kind: "image" | "video") =>
    apiPreviewRequestMock(body, kind),
  apiSubmitVideo: vi.fn(),
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
      return { data: undefined, isLoading: false };
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
  /* 适配器索引给上该模型的 T2I 条目：索引已加载且模型支持默认模式，
   * 候选不会被「按模式收窄」滤空。 */
  adaptersAll = { "agnes-image": [{ mode: "T2I" }] };
  upstreamPreview = [];
  apiPreviewRequestMock.mockReset();
  apiGenerateImageMock.mockReset();
  mutateAsyncSpy.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useModelTest：生成前的请求预览（ISSUE #3995）", () => {
  it("选中模型、未点生成：previewRows 首行是本地提交行、后随实际请求行，预览请求带 kind", async () => {
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
    expect(result.current.previewRows).toHaveLength(2);
    const localRow = result.current.previewRows[0];
    expect(localRow?.phase).toBe("relay");
    expect(localRow?.endpoint).toBe("/api/workshop-api/generate");
    expect(localRow?.body).toMatchObject({
      kind: "image",
      mode: "T2I",
      model: "agnes-image",
      prompt: "测试提示词",
    });
    expect(result.current.previewRows[1]).toEqual(UPSTREAM_ROW);
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
    expect(result.current.previewRows).toEqual([]);
  });

  it("点生成：debugRows 首行是本地提交行，产物落位后预览让位（真实读数接棒）", async () => {
    apiGenerateImageMock.mockResolvedValue("https://img.example/x.png");
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
    );
    expect(result.current.result).toEqual({ kind: "image", url: "https://img.example/x.png" });
    expect(result.current.generating).toBe(false);
    expect(result.current.debugRows).toHaveLength(1);
    const localRow = result.current.debugRows[0];
    expect(localRow?.phase).toBe("relay");
    expect(localRow?.endpoint).toBe("/api/workshop-api/generate");
    expect(localRow?.body).toMatchObject({ kind: "image", prompt: "测试提示词" });
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
    expect(result.current.debugRows).toHaveLength(1);
    const chatRow = result.current.debugRows[0];
    expect(chatRow?.endpoint).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(chatRow?.durationMs).toBe(1234);
    expect(chatRow?.excerpt).toBe("pong");
    expect(chatRow?.body).toMatchObject({ kind: "chat", model: "qwen3-8b", prompt: "ping" });
  });
});
