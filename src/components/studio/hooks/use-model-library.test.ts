// @vitest-environment jsdom
// 工作室模型库逻辑层单测：hook 走真实 tRPC React 客户端（api.model.list /
// api.model.sync），由 MSW 在网络层转发到可控测试 router，因此断言的是
// **真实管线下的 loading → data 流转**，而不是 vi.mock 的永不 resolve 桩。

import { createElement, type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { httpBatchStreamLink } from "@trpc/client";
import { TRPCError } from "@trpc/server";
import SuperJSON from "superjson";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createTestTRPC } from "../../../../tests/helpers/test-trpc";
import { setupTrpcServer } from "../../../../tests/helpers/trpc-msw";
import { createTestQueryClient } from "../../../../tests/helpers/renderWithProviders";
import { api } from "~/trpc/react";

import { useModelLibrary } from "./use-model-library";
import { ALL_TYPES } from "../model-library-config";

type Row = {
  id: string;
  name: string;
  type: string;
  fileName: string;
  isAvailable: boolean;
  fileSize?: number | null;
  createdAt: string;
};

interface Behavior {
  models: Row[];
  /** 非空时 list 抛错 —— 覆盖错误态 */
  listError?: string;
  /** 非空时 sync 抛错 —— 覆盖静默同步失败 */
  syncError?: string;
}

let behavior: Behavior = { models: [] };
/** 记录 list 收到的入参，用于断言筛选真的传到了后端 */
const listInputs: Array<{ type?: string; q?: string } | undefined> = [];

const t = createTestTRPC();
const mockRouter = t.router({
  model: t.router({
    list: t.procedure.query(({ input }) => {
      listInputs.push(input);
      if (behavior.listError) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: behavior.listError,
        });
      }
      return { models: behavior.models };
    }),
    sync: t.procedure.mutation(() => {
      if (behavior.syncError) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: behavior.syncError,
        });
      }
      return { ok: true, count: behavior.models.length };
    }),
  }),
});

const server = setupTrpcServer(mockRouter);

const ONE: Row = {
  id: "m1",
  name: "dreamshaper-xl",
  type: "checkpoints",
  fileName: "dreamshaper-xl.safetensors",
  isAvailable: true,
  fileSize: 5120,
  createdAt: "2026-01-01T00:00:00.000Z",
};
const TWO: Row = { ...ONE, id: "m2", name: "Detail Tweaker", type: "loras", fileName: "detail.safetensors" };
const THREE: Row = { ...ONE, id: "m3", name: "Anime Style", type: "loras", fileName: "anime.safetensors" };

/**
 * hook 用到 api.model.*，必须挂在真实的 tRPC Provider 下。
 * 用 createElement 而不是 JSX：本文件是 `.test.ts`（要求 .tsx 一律 PascalCase，
 * 而 hook 的测试伙伴文件按 必须 kebab-case），带 JSX 就得改名成 `Use*Test.tsx`，
 * 反而更怪。
 */
function makeWrapper() {
  const qc = createTestQueryClient();
  const client = api.createClient({
    links: [
      httpBatchStreamLink({
        transformer: SuperJSON,
        url: "http://localhost:3000/api/trpc",
      }),
    ],
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: qc },
      // eslint-disable-next-line react/no-children-prop -- createElement 的第三参即 children，tRPC 的 ProviderProps 要求它带在 props 上
      createElement(api.Provider, { client, queryClient: qc, children }),
    );
  };
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  behavior = { models: [] };
  listInputs.length = 0;
  server.resetHandlers();
});
afterAll(() => server.close());

describe("useModelLibrary", () => {
  it("挂载：静默同步后 loading 收敛到 false，并拿到模型行", async () => {
    behavior = { models: [ONE] };
    const { result } = renderHook(() => useModelLibrary(), { wrapper: makeWrapper() });

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 3000 });
    expect(result.current.models).toHaveLength(1);
    expect(result.current.models[0]?.fileName).toBe("dreamshaper-xl.safetensors");
  });

  it("筛选与搜索：filtered / typeChips 随状态派生（本地筛选，不打新请求）", async () => {
    behavior = { models: [ONE, TWO, THREE] };
    const { result } = renderHook(() => useModelLibrary(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.filtered).toHaveLength(3);
    // 类型 chips 按数量降序
    expect(result.current.typeChips).toEqual([
      ["loras", 2],
      ["checkpoints", 1],
    ]);

    const callsBefore = listInputs.length;
    act(() => result.current.setFilter("loras"));
    expect(result.current.filtered.map((m) => m.id)).toEqual(["m2", "m3"]);

    act(() => result.current.setQ("anime"));
    expect(result.current.filtered.map((m) => m.id)).toEqual(["m3"]);

    act(() => result.current.setQ(""));
    act(() => result.current.setFilter(ALL_TYPES));
    expect(result.current.filtered).toHaveLength(3);
    // 筛选是纯本地派生：不应该为了筛选再发请求
    expect(listInputs.length).toBe(callsBefore);
  });

  it("类型 count 为 0 时 chips 不出现（数据驱动，不是写死的目录表）", async () => {
    behavior = { models: [ONE] };
    const { result } = renderHook(() => useModelLibrary(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.typeChips).toEqual([["checkpoints", 1]]);
  });

  it("sync 失败不阻塞列表：loading 仍收敛，行照常渲染", async () => {
    behavior = { models: [ONE], syncError: "ComfyUI 未启动" };
    const { result } = renderHook(() => useModelLibrary(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 3000 });
    expect(result.current.models).toHaveLength(1);
  });
});
