// @vitest-environment jsdom
// 模型目录配置弹层逻辑层单测：走真实 tRPC React 客户端（configList /
// configSave / configDelete / sync），MSW 转发到可控测试 router。
// 断言的是「写操作后必刷新」这条编排契约，以及失败时的错误出口。

import { createElement, type ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchStreamLink } from "@trpc/client";
import { TRPCError } from "@trpc/server";
import SuperJSON from "superjson";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createTestTRPC, testTrpcEndpoint } from "../../../../tests/helpers/test-trpc";
import { setupTrpcServer } from "../../../../tests/helpers/trpc-msw";
import { createTestQueryClient } from "../../../../tests/helpers/renderWithProviders";
import { z } from "zod";

import { TRPCProvider, createTrpcClient } from "~/trpc/react";

import { useModelFolderConfig } from "./use-model-folder-config";

type Folder = {
  count: number;
  enabled: boolean;
  folder: string;
  hasConfig: boolean;
  label: string;
  type: string;
};

type Behavior = {
  comfyReachable?: boolean;
  /** 非空时 configDelete 抛错 */
  deleteError?: string;
  folders: Array<Folder>;
  /** 非空时 configList 抛错 */
  listError?: string;
  /** 非空时 configSave 抛错 */
  saveError?: string;
  /** 非空时 sync 抛错 */
  syncError?: string;
};

let behavior: Behavior = { folders: [], comfyReachable: true };
const saveInputs: Array<{ enabled: boolean; folder: string }> = [];
/** 记录 configList 被调用的次数 —— 断言「挂载时加载一次」不随重渲染复发。 */
let configListCalls = 0;
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
      configListCalls += 1;
      if (behavior.listError !== undefined && behavior.listError !== "") {
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
        if (behavior.saveError !== undefined && behavior.saveError !== "") {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: behavior.saveError,
          });
        }
        return { ok: true };
      }),
    configDelete: t.procedure.input(z.object({ folder: z.string() })).mutation(({ input }) => {
      deleteInputs.push(input);
      if (behavior.deleteError !== undefined && behavior.deleteError !== "") {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: behavior.deleteError,
        });
      }
      return { ok: true };
    }),
    sync: t.procedure.mutation(() => {
      if (behavior.syncError !== undefined && behavior.syncError !== "") {
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

function makeWrapper(explicitClient?: QueryClient) {
  const qc = explicitClient ?? createTestQueryClient();
  const client = createTrpcClient({
    links: [
      httpBatchStreamLink({
        transformer: SuperJSON,
        url: testTrpcEndpoint(),
      }),
    ],
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: qc },
      // eslint-disable-next-line react/no-children-prop -- createElement 的第三参即 children，tRPC 的 ProviderProps 要求它带在 props 上
      createElement(TRPCProvider, {
        trpcClient: client,
        queryClient: qc,
        children,
      }),
    );
  };
}

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  cleanup();
  behavior = { folders: [], comfyReachable: true };
  saveInputs.length = 0;
  deleteInputs.length = 0;
  configListCalls = 0;
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
    await expect.poll(() => result.current.loading).toBe(false);
    expect(result.current.totalCount).toBe(2);
    expect(result.current.enabledRows.map((r) => r.folder)).toEqual(["checkpoints"]);
    expect(result.current.availableRows.map((r) => r.folder)).toEqual(["loras"]);
    expect(result.current.comfyReachable).toBe(false);
  });

  /**
   * 复现（现场：没配 ComfyUI 路径的机器上，弹层仍写「● ComfyUI 已连接 · 共 0 个目录」）：
   * 服务端那次探测必然落空（`comfyBase()` 指向没人监听的 8188 ⇒ `fetch` 抛错 ⇒ false），
   * 所以「已连接」只能来自**客户端的乐观默认值** `useState(true)`。
   *
   * 为什么第一次打开是对的、第二次开始骗人：`ModelConfigModal` 随开随卸载
   * （`{c.configOpen && <ModelConfigModal/>}`），而 QueryClient 是模块级单例
   * （`src/trpc/query-client.ts`：staleTime 30s、gcTime 默认 5min）⇒ 第二次挂载时
   * `useQuery` 首帧就带着缓存数据，于是「渲染期同步」那句 `data !== prevCfgData`
   * 的初值就是这份数据 ⇒ 同步永不发生；随后 `refetch()` 拿回**逐字相同**的载荷，
   * react-query 的结构共享（`replaceEqualDeep`）让 `data` 的引用也没变 ⇒ 仍然不同步。
   * 结论：`comfyReachable` 会一直停在 `true`。
   */
  it("缓存已热的第二次挂载：comfyReachable 不许停在乐观默认值上", async () => {
    behavior = {
      folders: [folder("checkpoints", true), folder("loras")],
      comfyReachable: false,
    };
    // 与真实应用同档：缓存跨挂载存活（createTestQueryClient 的 gcTime:0 会抹掉这一格）。
    const warm = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
    });
    const wrapper = makeWrapper(warm);

    const first = renderHook(() => useModelFolderConfig(), { wrapper });
    await expect.poll(() => first.result.current.loading).toBe(false);
    expect(first.result.current.comfyReachable).toBe(false);
    expect(first.result.current.totalCount).toBe(2);
    first.unmount();

    const second = renderHook(() => useModelFolderConfig(), { wrapper });
    await expect.poll(() => second.result.current.loading).toBe(false);
    expect(second.result.current.totalCount).toBe(2);
    expect(second.result.current.comfyReachable).toBe(false);
    second.unmount();
    warm.clear();
  });

  /**
   * 同一条链上的第二格：`load()` 里那句 `catch { setErr("网络错误") }` 是**死代码**。
   * react-query v5 的 `refetch()` 失败时不 reject，而是 resolve 一个 `isError` 结果
   * ⇒ 列表拉不下来时既不落 err、也不改 comfyReachable，界面于是把「没拿到答案」
   * 显示成「已连接 + 没有目录」两条假结论。
   */
  it("configList 失败：错误必须可见，且不许冒充「已连接」", async () => {
    behavior = { folders: [], comfyReachable: false, listError: "boom" };
    const { result } = renderHook(() => useModelFolderConfig(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.loading).toBe(false);
    expect(result.current.err).toBe("boom");
    expect(result.current.comfyReachable).toBe(false);
  });

  /* 回归：挂载 effect 的依赖曾经是 `[load]`，而 `load` 依赖 `configQ`、
   * 后者是 `useQuery` 的返回值（**每次渲染都是新引用**）⇒ 每次渲染都重跑
   * ⇒ 反复 refetch ⇒ 数据到达又触发渲染 ⇒ 自激。实测弹层打开后静置时
   * `model.configList` 每 25ms 打一次（5 秒 194 次，ISSUE #1803）。 */
  it("重渲染不复发首屏加载：configList 只在挂载时取一次", async () => {
    behavior = { folders: [folder("checkpoints", true)] };
    const { result, rerender } = renderHook(() => useModelFolderConfig(), {
      wrapper: makeWrapper(),
    });
    /* 基数要等挂载链**彻底落定**之后再取。挂载期不止一个来源：`useQuery` 自己首发一次，
     * 首次加载的 effect 又用 `setTimeout(0)` 排了一次 `refetch`（就是上面 #1803 那条修法
     * 留下的形状）。只等「至少发过一次」就会把后面那一发算到重渲染之后 ⇒ 满载下实测正是
     * `expected 2 to be 1` 的假红（本机 24 个忙等进程，3/3 复现）。这里用本文件既有的
     * 落定信号：`loading` 回到 false —— 它只在 effect 那次 `refetch` 的 finally 里被写，
     * 等到它就说「挂载期已经走完」。 */
    await expect.poll(() => result.current.loading).toBe(false);
    /* 基数按「落定之后的实际值」取，不写死数字，也不去猜挂载期该发几次 ——
     * 断言的是**重渲染之后不再增长**这一条。 */
    const afterMount = configListCalls;

    for (let i = 0; i < 5; i++) {
      rerender();
      // 逐轮推进微任务队列，模拟真实重渲染节奏
      await act(async () => {
        await Promise.resolve();
      });
    }
    expect(configListCalls).toBe(afterMount);
  });

  it("toggle：写入后端并在结束后刷新（写操作统一走 runMutate）", async () => {
    behavior = { folders: [folder("checkpoints", true), folder("loras")] };
    const { result } = renderHook(() => useModelFolderConfig(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.loading).toBe(false);

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
    await expect.poll(() => result.current.loading).toBe(false);

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
    await expect.poll(() => result.current.loading).toBe(false);

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
    await expect.poll(() => result.current.loading).toBe(false);

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
    await expect.poll(() => result.current.loading).toBe(false);

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
    await expect.poll(() => result.current.loading).toBe(false);

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
    await expect.poll(() => result.current.loading).toBe(false);

    act(() => result.current.setQ("lora"));
    expect(result.current.enabledRows).toEqual([]);
    expect(result.current.availableRows.map((r) => r.folder)).toEqual(["loras"]);
  });
});
