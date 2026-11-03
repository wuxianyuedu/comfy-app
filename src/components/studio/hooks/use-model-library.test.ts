// @vitest-environment jsdom
// 工作室模型库逻辑层单测：hook 走真实 tRPC React 客户端（trpc.model.list /
// trpc.model.sync 的 options），由 MSW 在网络层转发到可控测试 router，因此断言的是
// **真实管线下的 loading → data 流转**，而不是 vi.mock 的永不 resolve 桩。

import { createElement, type ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { httpBatchStreamLink } from "@trpc/client";
import { http } from "msw/http";
import { TRPCError } from "@trpc/server";
import SuperJSON from "superjson";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createTestTRPC, testTrpcEndpoint } from "../../../../tests/helpers/test-trpc";
import { forwardForTest, setupTrpcServer } from "../../../../tests/helpers/trpc-msw";
import { createTestQueryClient } from "../../../../tests/helpers/renderWithProviders";
import { TRPCProvider, createTrpcClient } from "~/trpc/react";

import { useModelLibrary, type ModelLibraryController } from "./use-model-library";
import { ALL_TYPES } from "../model-library-config";

type Row = {
  createdAt: string;
  fileName: string;
  fileSize?: number | null;
  id: string;
  isAvailable: boolean;
  name: string;
  type: string;
};

type Behavior = {
  /** 非空时 list 抛错 —— 覆盖错误态 */
  listError?: string;
  models: Array<Row>;
  /** 非空时 sync 抛错 —— 覆盖静默同步失败 */
  syncError?: string;
};

let behavior: Behavior = { models: [] };
/** 记录 list 收到的入参，用于断言筛选真的传到了后端 */
const listInputs: Array<{ q?: string; type?: string } | undefined> = [];
/** 记录 sync 被调用的次数 —— 断言「挂载时同步一次」不会随重渲染复发。
 *  它是**跨用例共享**的模块级计数：用例必须在自己的请求全部落地后才结束
 *  （见 waitSyncSettled），否则迟到的 handler 会在 afterEach 清零之后才执行，
 *  把 +1 落进下一条用例（ISSUE #2911 的串号根因）。 */
let syncCalls = 0;

const t = createTestTRPC();
const mockRouter = t.router({
  model: t.router({
    list: t.procedure.query(({ input }) => {
      listInputs.push(input);
      if (behavior.listError !== undefined && behavior.listError !== "") {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: behavior.listError,
        });
      }
      return { models: behavior.models };
    }),
    sync: t.procedure.mutation(() => {
      syncCalls += 1;
      if (behavior.syncError !== undefined && behavior.syncError !== "") {
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
const TWO: Row = {
  ...ONE,
  id: "m2",
  name: "Detail Tweaker",
  type: "loras",
  fileName: "detail.safetensors",
};
const THREE: Row = {
  ...ONE,
  id: "m3",
  name: "Anime Style",
  type: "loras",
  fileName: "anime.safetensors",
};

/**
 * hook 用到 trpc.model.*，必须挂在真实的 tRPC Provider 下。
 * 用 createElement 而不是 JSX：本文件是 `.test.ts`（带 JSX 就得改名成 PascalCase，
 * 而 hook 测试伙伴文件按约定是 kebab-case，反而更怪）。
 */
function makeWrapper() {
  const qc = createTestQueryClient();
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

/**
 * 等本用例挂载的那次静默同步「已发车且全链落地」，让用例结束在**静止态**。为什么需要它
 *（ISSUE #2911）：sync 经 `setTimeout(…,0)` 发车、与 list 并行，且 sync 的 `onSettled` 还会
 * 触发一次静默 refetch；原收尾只等 `loading` 收敛，负载下回包可晚于 `afterEach` 清零后到达。
 */
async function waitSyncSettled(result: { current: ModelLibraryController }): Promise<void> {
  await expect.poll(() => syncCalls, { message: "挂载时的静默同步应已记账" }).toBe(1);
  await expect
    .poll(() => listInputs.length, { message: "初次 list 与 sync 触发的 refetch 应都已到达" })
    .toBe(2);
  await expect
    .poll(() => result.current.refreshing, { message: "sync 与其触发的 refetch 应已落地" })
    .toBe(false);
}

beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});
afterEach(() => {
  cleanup();
  behavior = { models: [] };
  listInputs.length = 0;
  syncCalls = 0;
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

describe("useModelLibrary", () => {
  it("挂载：静默同步后 loading 收敛到 false，并拿到模型行", async () => {
    behavior = { models: [ONE] };
    const { result } = renderHook(() => useModelLibrary(), {
      wrapper: makeWrapper(),
    });

    expect(result.current.loading).toBe(true);
    await expect.poll(() => result.current.loading).toBe(false);
    expect(result.current.models).toHaveLength(1);
    expect(result.current.models[0]?.fileName).toBe("dreamshaper-xl.safetensors");
    await waitSyncSettled(result);
  });

  /* 回归：effect 的依赖数组曾经是 `[syncMut, reload]`，而这两个引用
   * 每次渲染都变（`useQuery` / `useMutation` 的返回值不是稳定引用）⇒ 每次渲染
   * 都重跑一次 sync mutation ⇒ mutation 完成又触发渲染 ⇒ 自激循环。
   * 线上实测形态是**静置时 `model.sync` 每 10~12ms 打一次、6 秒 505 次**，
   * 且当时打开的整个视图每秒被重渲染上千次（ISSUE #1803）。 */
  it("重渲染不复发静默同步：sync 只在挂载时调一次", async () => {
    behavior = { models: [ONE] };
    const { result, rerender } = renderHook(() => useModelLibrary(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.loading).toBe(false);
    /* 先等本用例自己的 sync 全链落地再计数（原先是裸读 `syncCalls`，负载下
     * handler 晚于 list 回包时会读到上一条用例的迟到 +1 / 自己的还没记账）；
     * 断言本身不弱化 —— 重渲染后仍是硬断言 `toBe(1)`。 */
    await waitSyncSettled(result);

    /* 反复重渲染（模拟父级因轮询 / 状态更新重渲染）：若依赖数组再回到不稳的
     * 引用上，这里会随之线性增长。 */
    for (let i = 0; i < 5; i++) {
      rerender();
      await act(async () => {
        await Promise.resolve();
      });
    }
    expect(syncCalls).toBe(1);
    expect(result.current.models).toHaveLength(1);
  });

  it("筛选与搜索：filtered / typeChips 随状态派生（本地筛选，不打新请求）", async () => {
    behavior = { models: [ONE, TWO, THREE] };
    const { result } = renderHook(() => useModelLibrary(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.loading).toBe(false);
    await waitSyncSettled(result);

    expect(result.current.filtered).toHaveLength(3);
    // 类型 chips 按数量降序
    expect(result.current.typeChips).toEqual([
      ["loras", 2],
      ["checkpoints", 1],
    ]);

    const callsBefore = listInputs.length;
    act(() => {
      result.current.setFilter("loras");
    });
    expect(result.current.filtered.map((m) => m.id)).toEqual(["m2", "m3"]);

    act(() => {
      result.current.setQ("anime");
    });
    expect(result.current.filtered.map((m) => m.id)).toEqual(["m3"]);

    act(() => {
      result.current.setQ("");
    });
    act(() => {
      result.current.setFilter(ALL_TYPES);
    });
    expect(result.current.filtered).toHaveLength(3);
    // 筛选是纯本地派生：不应该为了筛选再发请求
    expect(listInputs.length).toBe(callsBefore);
  });

  it("类型 count 为 0 时 chips 不出现（数据驱动，不是写死的目录表）", async () => {
    behavior = { models: [ONE] };
    const { result } = renderHook(() => useModelLibrary(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.loading).toBe(false);
    await waitSyncSettled(result);
    expect(result.current.typeChips).toEqual([["checkpoints", 1]]);
  });

  it("sync 失败不阻塞列表：loading 仍收敛，行照常渲染", async () => {
    behavior = { models: [ONE], syncError: "ComfyUI 未启动" };
    const { result } = renderHook(() => useModelLibrary(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.loading).toBe(false);
    /* sync 失败同样走 onSettled → 静默 refetch：syncCalls 仍记账 1、list 仍到 2，
     * 收尾判定与成功路径同一条（见 waitSyncSettled）。 */
    await waitSyncSettled(result);
    expect(result.current.models).toHaveLength(1);
  });
});

/**
 * 回归：游离 promise 链在卸载后不得再 setState（ISSUE #489）。`loadModels` 里
 * `listQ.refetch().finally(...)` 脱离组件生命周期；测试结束后 jsdom 已拆、window 消失它才
 * resolve，setLoading 触发 React 调度读 window 抛错。`pnpm test` 随机非零退出（65 轮 4 轮）即此。
 */
describe("useModelLibrary 卸载后不再 setState", () => {
  it("卸载后 refetch 回包不得触发更新调度（原缺陷：React 读到已拆除的 window）", async () => {
    /* 把原来「只在全量并行下偶然出现」的时序变成**必现**：让 list 回包卡到显式放行，
     * 于是 `.finally` 必然发生在 unmount 之后。判据是**更新调度被触发的次数**：React 在
     * 无活动 fiber 时接到 setState 会走 `resolveUpdatePriority` 读 `globalThis.window`；
     * 记账替身只统计调用栈含调度函数的读取（修好 2 次 / 没修 4 次；全量统计 7 vs 16 混噪声）。
     * 反向验证：把 finally 改回无条件 `setLoading(false)`，本条必挂。 */
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let listBlocked = false;
    behavior = { models: [ONE] };

    const gatedRouter = t.router({
      model: t.router({
        list: t.procedure.query(async () => {
          listBlocked = true;
          await gate;
          return { models: [ONE] };
        }),
        sync: t.procedure.mutation(() => ({ ok: true, count: 1 })),
      }),
    });
    server.use(
      http.all("*/api/trpc/*", async ({ request }) => forwardForTest(request, gatedRouter)),
    );

    const { result, unmount } = renderHook(() => useModelLibrary(), {
      wrapper: makeWrapper(),
    });
    /* 前提：**查询真的在飞、且回包被卡住**。两件事要等到同一个时刻再断言 ——
     * `listBlocked` 由 msw 处理器置位（服务端那一侧），而 `loading` 是 React
     * 提交渲染后才读得到的客户端状态；只等 `listBlocked` 就紧接着读 `loading`，
     * 满载时会在 React 提交之前读到 `false`（实测：全量档偶发、隔离重跑必绿）。
     * 等 `loading` 也从 `false` 转过来，判的是「这一刻两者都成立」。 */
    await expect
      .poll(() => listBlocked && result.current.loading, {
        message: "前提：查询在飞、回包被卡住（loading 与 listBlocked 同时成立）",
      })
      .toBe(true);

    /* 记账替身：透传真实 window（react-query 会调它的方法，返回假对象会
     * 抛 `window.removeEventListener is not a function`），只计数。 */
    let scheduleReads = 0;
    const realWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const spy = {
      configurable: true,
      get() {
        const stack = new Error().stack ?? "";
        if (/resolveUpdatePriority|dispatchSetState|scheduleUpdateOnFiber/.test(stack)) {
          scheduleReads += 1;
        }
        /* SAFETY: 类型断言已复核 */
        return realWindow?.value as unknown;
      },
    };
    Object.defineProperty(globalThis, "window", spy);

    let baseline;
    let after;
    try {
      // 基线：卸载前把这一瞬间的调度读取数记下来
      baseline = scheduleReads;
      unmount();
      after = scheduleReads;
      release();
      /* 这一处是**「等一个不会发生的事」**：放行回包之后，判定「不再有任何新的
       * 调度读取」。条件轮询只能表达「某件事发生了」，而这条判据要证明的是
       * 「回包之后一个都没多」——只能给真时间让它有机会发生（§11.14 的合法逃逸口）。 */
      // sleep-ok: 等一个「不会发生的事」——放行后不得再出现更新调度读取。
      await new Promise((r) => setTimeout(r, 150));
    } finally {
      if (realWindow) {
        Object.defineProperty(globalThis, "window", realWindow);
      }
    }

    /* 判据：**回包之后**不得再出现更新调度读取。
     * 不写死绝对值（卸载自身会贡献若干次，绝对数随 React 小版本漂移），
     * 而是与「放行前」那一刻比较 —— 放行后才多出来的，只能是游离 promise。 */
    expect(
      scheduleReads - after,
      "卸载后的 refetch 回包仍在触发 React 更新调度（原缺陷：React 去读已拆除的 " +
        "window 并抛 ReferenceError）—— loadModels 的 finally 必须先判 aliveRef 再 setLoading",
    ).toBe(0);
    expect(baseline).toBeGreaterThanOrEqual(0);
  });
});
