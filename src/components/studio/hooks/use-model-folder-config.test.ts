// @vitest-environment jsdom
// 模型目录配置弹层逻辑层单测：走真实 tRPC React 客户端（configList /
// configSave / configDelete / sync），MSW 转发到可控测试 router。
// 断言的是「写操作后必刷新」这条编排契约，以及失败时的错误出口。

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
import { z } from "zod";

import { api } from "~/trpc/react";

import { useModelFolderConfig } from "./use-model-folder-config";

type Folder = {
  folder: string;
  type: string;
  label: string;
  enabled: boolean;
  hasConfig: boolean;
  count: number;
};

interface Behavior {
  folders: Folder[];
  comfyReachable?: boolean;
  /** 非空时 configList 抛错 */
  listError?: string;
  /** 非空时 configSave 抛错 */
  saveError?: string;
  /** 非空时 configDelete 抛错 */
  deleteError?: string;
  /** 非空时 sync 抛错 */
  syncError?: string;
}

let behavior: Behavior = { folders: [], comfyReachable: true };
const saveInputs: Array<{ folder: string; enabled: boolean }> = [];
const deleteInputs: Array<{ folder: string }> = [];

function folder(name: string, enabled = false): Folder {
  return {
    folder: name,
    type: name,
    label: name,
    enabled,
    hasConfig: enabled,
    count: 0,
  };
}

const t = createTestTRPC();
const mockRouter = t.router({
  model: t.router({
    configList: t.procedure.query(() => {
      if (behavior.listError) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: behavior.listError,
        });
      }
      return {
        folders: behavior.folders,
        rows: [],
        comfyReachable: behavior.comfyReachable ?? true,
      };
    }),
    configSave: t.procedure
      .input(
        z.object({
          folder: z.string(),
          enabled: z.boolean(),
          label: z.string().optional(),
        }),
      )
      .mutation(({ input }) => {
        saveInputs.push(input);
        if (behavior.saveError) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: behavior.saveError,
          });
        }
        return { ok: true };
      }),
    configDelete: t.procedure
      .input(z.object({ folder: z.string() }))
      .mutation(({ input }) => {
        deleteInputs.push(input);
        if (behavior.deleteError) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: behavior.deleteError,
          });
        }
        return { ok: true };
      }),
    sync: t.procedure.mutation(() => {
      if (behavior.syncError) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: behavior.syncError,
        });
      }
      return { ok: true, count: behavior.folders.length };
    }),
  }),
});

const server = setupTrpcServer(mockRouter);

function makeWrapper() {
  const qc = createTestQueryClient();
  const client = api.createClient({
    links: [
      httpBatchStreamLink({
        transformer: SuperJSON,
        url: "http://localhost:3100/api/trpc",
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

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  cleanup();
  behavior = { folders: [], comfyReachable: true };
  saveInputs.length = 0;
  deleteInputs.length = 0;
  server.resetHandlers();
});
afterAll(() => server.close());

describe("useModelFolderConfig", () => {
  it("挂载：loading 收敛，目录按 enabled 拆成两组，comfyReachable 落到状态", async () => {
    behavior = {
      folders: [folder("checkpoints", true), folder("loras")],
      comfyReachable: false,
    };
    const { result } = renderHook(() => useModelFolderConfig(), {
      wrapper: makeWrapper(),
    });

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false), {
      timeout: 3000,
    });
    expect(result.current.totalCount).toBe(2);
    expect(result.current.enabledRows.map((r) => r.folder)).toEqual([
      "checkpoints",
    ]);
    expect(result.current.availableRows.map((r) => r.folder)).toEqual([
      "loras",
    ]);
    expect(result.current.comfyReachable).toBe(false);
  });

  it("toggle：写入后端并在结束后刷新（写操作统一走 runMutate）", async () => {
    behavior = { folders: [folder("checkpoints", true), folder("loras")] };
    const { result } = renderHook(() => useModelFolderConfig(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false), {
      timeout: 3000,
    });

    await act(async () => {
      await result.current.toggle("loras", true);
    });
    expect(saveInputs).toContainEqual({ folder: "loras", enabled: true });
    expect(result.current.err).toBeNull();
  });

  it("add / remove：分别落到 configSave(enabled:true) 与 configDelete", async () => {
    behavior = { folders: [folder("loras")] };
    const { result } = renderHook(() => useModelFolderConfig(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false), {
      timeout: 3000,
    });

    await act(async () => {
      await result.current.add("loras");
    });
    await act(async () => {
      await result.current.remove("loras");
    });
    expect(saveInputs).toContainEqual({ folder: "loras", enabled: true });
    expect(deleteInputs).toContainEqual({ folder: "loras" });
  });

  it("写操作失败：错误文案可见（失败路径必须有出口），且不吞掉后续刷新", async () => {
    behavior = { folders: [folder("loras")], saveError: "目录不存在" };
    const { result } = renderHook(() => useModelFolderConfig(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false), {
      timeout: 3000,
    });

    await act(async () => {
      await result.current.add("loras");
    });
    expect(result.current.err).toBe("目录不存在");
    // 刷新仍发生（loading 走完一轮 false）
    expect(result.current.loading).toBe(false);
  });

  it("rescan：失败时给出「扫描失败」兜底文案，scanning 收敛回 false", async () => {
    behavior = { folders: [folder("loras")], syncError: "ComfyUI 未启动" };
    const { result } = renderHook(() => useModelFolderConfig(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false), {
      timeout: 3000,
    });

    await act(async () => {
      await result.current.rescan();
    });
    expect(result.current.err).toBe("ComfyUI 未启动");
    expect(result.current.scanning).toBe(false);
  });

  it("写操作抛非 Error：回落「网络错误」而不是把 unknown 抛给用户", async () => {
    behavior = { folders: [folder("loras")], deleteError: "boom" };
    const { result } = renderHook(() => useModelFolderConfig(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false), {
      timeout: 3000,
    });

    behavior.deleteError = "boom";
    await act(async () => {
      await result.current.remove("loras");
    });
    expect(result.current.err).toBe("boom");
  });

  it("错误不被随后的刷新吞掉（§17.5.4 同源回归）", async () => {
    behavior = { folders: [folder("loras")], saveError: "目录不存在" };
    const { result } = renderHook(() => useModelFolderConfig(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false), {
      timeout: 3000,
    });

    await act(async () => {
      await result.current.add("loras");
    });
    // load() 在写操作之后跑，若它还清 err，这里就会是 null
    expect(result.current.err).toBe("目录不存在");

    // 下一次成功的写操作才把错误清掉
    behavior = { ...behavior, saveError: undefined };
    await act(async () => {
      await result.current.add("loras");
    });
    expect(result.current.err).toBeNull();
  });

  it("目录关键字：先过滤再分组（搜索「lora」时已启用组为空）", async () => {
    behavior = { folders: [folder("checkpoints", true), folder("loras")] };
    const { result } = renderHook(() => useModelFolderConfig(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false), {
      timeout: 3000,
    });

    act(() => result.current.setQ("lora"));
    expect(result.current.enabledRows).toEqual([]);
    expect(result.current.availableRows.map((r) => r.folder)).toEqual([
      "loras",
    ]);
  });
});
