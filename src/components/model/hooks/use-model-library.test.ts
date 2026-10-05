// /models 页模型卡片库逻辑层单测：整体替换 vanillaApi，断言的是
// 筛选即重新查询、sync 后按当前筛选刷新这两条编排契约。

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { vanillaApi } from "~/trpc/vanilla";

import { modelListParams, useModelLibrary } from "./use-model-library";

vi.mock("~/trpc/vanilla", () => ({
  vanillaApi: {
    model: {
      list: { query: vi.fn() },
      sync: { mutate: vi.fn() },
    },
  },
}));

/** tRPC resolver 的类型是 Resolver<...>，测试里按 vi.Mock 取用。 */
const mockOf = (fn: unknown) => fn as Mock;

const vanilla = {
  model: {
    list: { query: mockOf(vanillaApi.model.list.query) },
    sync: { mutate: mockOf(vanillaApi.model.sync.mutate) },
  },
};

function card(id: string, type = "CHECKPOINT") {
  return { id, name: `model-${id}`, type, cover: undefined, uses: 0, likes: 0 };
}

beforeEach(() => {
  vi.clearAllMocks();
  vanilla.model.list.query.mockResolvedValue({
    models: [card("1"), card("2", "LORA")],
  });
  vanilla.model.sync.mutate.mockResolvedValue({ ok: true, count: 2 });
});

afterEach(cleanup);

describe("modelListParams（纯函数：查询参数构造）", () => {
  it("两个筛选都为空时不带任何参数（后端入参是 optional）", () => {
    expect(modelListParams("", "")).toEqual({});
  });

  it("只带非空的那一个", () => {
    expect(modelListParams("LORA", "")).toEqual({ type: "LORA" });
    expect(modelListParams("", "xl")).toEqual({ q: "xl" });
  });

  it("两个都非空时一起带", () => {
    expect(modelListParams("LORA", "xl")).toEqual({ type: "LORA", q: "xl" });
  });
});

describe("useModelLibrary", () => {
  it("挂载即拉取，loading 由 true 收敛到 false", async () => {
    const { result } = renderHook(() => useModelLibrary());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.models).toHaveLength(2);
    // 无筛选时后端收到空参数
    expect(vanilla.model.list.query).toHaveBeenCalledWith({});
  });

  it("切换类型即重新查询，参数只带 type", async () => {
    const { result } = renderHook(() => useModelLibrary());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.setType("LORA");
    });
    await waitFor(() =>
      expect(vanilla.model.list.query).toHaveBeenLastCalledWith({
        type: "LORA",
      }),
    );
  });

  it("搜索关键字参与查询，且与 type 是叠加关系", async () => {
    const { result } = renderHook(() => useModelLibrary());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.setType("LORA");
      result.current.setQ("xl");
    });
    await waitFor(() =>
      expect(vanilla.model.list.query).toHaveBeenLastCalledWith({
        type: "LORA",
        q: "xl",
      }),
    );
  });

  it("sync：先同步再按当前筛选重新拉取，syncing 收敛回 false", async () => {
    const { result } = renderHook(() => useModelLibrary());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      result.current.setType("LORA");
    });
    await waitFor(() => expect(result.current.type).toBe("LORA"));

    await act(async () => {
      await result.current.sync();
    });
    expect(vanilla.model.sync.mutate).toHaveBeenCalled();
    expect(vanilla.model.list.query).toHaveBeenLastCalledWith({ type: "LORA" });
    expect(result.current.syncing).toBe(false);
  });

  it("sync 失败：错误向外抛（调用方决定怎么提示），syncing 必须收敛", async () => {
    vanilla.model.sync.mutate.mockRejectedValue(new Error("ComfyUI 未启动"));
    const { result } = renderHook(() => useModelLibrary());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(result.current.sync()).rejects.toThrow("ComfyUI 未启动");
    });
    expect(result.current.syncing).toBe(false);
  });

  it("list 失败：保留上一次列表、loading 收敛（不让页面弹空白）", async () => {
    const { result } = renderHook(() => useModelLibrary());
    await waitFor(() => expect(result.current.loading).toBe(false));

    vanilla.model.list.query.mockRejectedValue(new Error("500"));
    await act(async () => {
      result.current.setType("VAE");
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.models).toHaveLength(2);
  });
});
