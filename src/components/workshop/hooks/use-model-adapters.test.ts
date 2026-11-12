// 「模型适配」逻辑层行为（ISSUE #3622 评论 1）：保存成功后**失效**存档与概览
// 两个查询 —— 此前保存只写库不碰缓存，页签切走再切回来时草稿按旧缓存播种，
// 刚配的模式「消失」一轮。本文件锁：① 保存后 invalidate 的 queryKey 对得上
// （存档按模型点名 + 概览整份）；② 保存返回值回灌草稿（与服务端归一化一致）；
// ③ 切换选中模型时草稿与模型级端点一起播种。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type * as TanStackQuery from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useModelAdapters } from "./use-model-adapters";

/* 忙碌位替身的开关（声明在 vi.mock 之前：工厂闭包在调用时才读它）。 */
let busyFlag = false;

/* configGet 下发的配置（extraModels = 候选清单）与各模型的存档查询返回。
 * 存档 queryKey 的第三段**就是模型名本身**（本文件的 tRPC 替身把 input 展开
 * 成字符串段），这样 useQuery 替身取名字不需要任何断言。 */
let configData: unknown;
let adaptersByName: Record<string, unknown>;

const mutateAsync = vi.fn<(input: unknown) => Promise<unknown>>();

/* tRPC 只给「能对上 queryKey」的 options/queryKey 工厂 —— 数据态由下面替掉的
 * useQuery 直接给（与 use-queue-monitor.test.ts 同一做法）。 */
vi.mock("~/trpc/react", () => ({
  useTRPC: () => ({
    llm: {
      configGet: { queryOptions: () => ({ queryKey: ["llm", "configGet"] }) },
      workshopAdaptersGet: {
        queryOptions: (input: { name: string }) => ({
          queryKey: ["llm", "workshopAdaptersGet", input.name],
        }),
        queryKey: (input: { name: string }) => ["llm", "workshopAdaptersGet", input.name],
      },
      workshopAdaptersSave: {
        mutationOptions: () => ({ mutationKey: ["llm", "workshopAdaptersSave"] }),
      },
      workshopAdaptersSummary: {
        queryOptions: () => ({ queryKey: ["llm", "workshopAdaptersSummary"] }),
        queryKey: () => ["llm", "workshopAdaptersSummary"],
      },
    },
  }),
}));

vi.mock("~/components/workshop/mode-contract/hooks/use-mode-contracts", () => ({
  useModeContracts: () => ({ contracts: [] }),
}));

vi.mock("~/components/ui/use-busy-action", () => ({
  useBusyAction: () => ({
    busy: busyFlag,
    run: (fn: () => Promise<unknown>) => fn(),
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
      if (ns === "llm" && ep === "workshopAdaptersGet" && typeof name === "string") {
        return { data: adaptersByName[name], isLoading: false };
      }
      if (ns === "llm" && ep === "workshopAdaptersSummary") {
        return { data: { models: [] }, isLoading: false };
      }
      return { data: undefined, isLoading: false };
    },
    useMutation: () => ({ mutateAsync }),
  };
});

/** 独立 QueryClient + 替掉的 useQuery/useMutation；invalidate 偵測用 spy。 */
function renderAdapters() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return { ...renderHook(() => useModelAdapters(), { wrapper }), invalidateSpy };
}

beforeEach(() => {
  busyFlag = false;
  configData = {
    config: {
      extraModels: [
        { baseUrl: "https://a/v1", kind: "image", name: "agnes-image" },
        { baseUrl: "https://b/v1", kind: "video", name: "sora-video" },
      ],
    },
  };
  adaptersByName = {};
  mutateAsync.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useModelAdapters：保存后的缓存失效（#3622 评论 1）", () => {
  it("保存成功 → 失效该模型的存档查询与概览查询，并把返回值回灌草稿", async () => {
    adaptersByName["agnes-image"] = { endpointPath: "", adapters: [] };
    const { result, invalidateSpy } = renderAdapters();
    await waitFor(() => {
      expect(result.current.candidates).toHaveLength(2);
    });

    act(() => {
      result.current.selectModel("agnes-image");
    });
    await waitFor(() => {
      expect(result.current.selectedModel).toBe("agnes-image");
    });

    act(() => {
      result.current.addMode("T2I");
    });
    expect(result.current.draft.map((a) => a.mode)).toEqual(["T2I"]);

    mutateAsync.mockResolvedValue({
      endpointPath: "/v1/images/generations",
      adapters: [
        { mode: "T2I", inputs: [{ type: "prompt", field: "prompt" }], outputField: "url" },
      ],
    });
    await act(async () => {
      await result.current.save();
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["llm", "workshopAdaptersGet", "agnes-image"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["llm", "workshopAdaptersSummary"],
    });
    /* 返回值回灌：草稿与服务端归一化后的形态一致；模型级端点也一起回灌。 */
    expect(result.current.draft.map((a) => a.mode)).toEqual(["T2I"]);
    expect(result.current.endpointPath).toBe("/v1/images/generations");
    expect(result.current.message?.kind).toBe("ok");
  });

  it("保存入参带模型级端点路径（与模式无关的一格）", async () => {
    adaptersByName["agnes-image"] = { endpointPath: "/x", adapters: [] };
    const { result } = renderAdapters();
    await waitFor(() => {
      expect(result.current.candidates).toHaveLength(2);
    });
    act(() => {
      result.current.selectModel("agnes-image");
    });
    await waitFor(() => {
      expect(result.current.endpointPath).toBe("/x");
    });
    act(() => {
      result.current.addMode("T2I");
    });
    mutateAsync.mockResolvedValue({ endpointPath: "/x", adapters: [] });
    await act(async () => {
      await result.current.save();
    });
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ endpointPath: "/x", name: "agnes-image" }),
    );
  });

  it("切换选中模型：草稿与端点按新模型的存档播种", async () => {
    adaptersByName = {
      "agnes-image": {
        endpointPath: "/i",
        adapters: [{ mode: "T2I", inputs: [{ type: "prompt", field: "prompt" }], outputField: "" }],
      },
      "sora-video": { endpointPath: "/v", adapters: [] },
    };
    const { result } = renderAdapters();
    await waitFor(() => {
      expect(result.current.candidates).toHaveLength(2);
    });
    act(() => {
      result.current.selectModel("agnes-image");
    });
    await waitFor(() => {
      expect(result.current.draft.map((a) => a.mode)).toEqual(["T2I"]);
    });
    expect(result.current.endpointPath).toBe("/i");

    act(() => {
      result.current.selectModel("sora-video");
    });
    await waitFor(() => {
      expect(result.current.selectedModel).toBe("sora-video");
    });
    expect(result.current.draft).toEqual([]);
    expect(result.current.endpointPath).toBe("/v");
  });
});
