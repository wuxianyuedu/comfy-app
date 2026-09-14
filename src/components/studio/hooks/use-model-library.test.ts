// @vitest-environment jsdom
// 工作室模型库逻辑层单测：hook 走真实 tRPC React 客户端（api.model.list /
// api.model.sync），由 MSW 在网络层转发到可控测试 router，因此断言的是
// **真实管线下的 loading → data 流转**，而不是 vi.mock 的永不 resolve 桩。

import { createElement, type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { httpBatchStreamLink } from "@trpc/client";
import { http } from "msw";
import { TRPCError } from "@trpc/server";
import SuperJSON from "superjson";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createTestTRPC } from "../../../../tests/helpers/test-trpc";
import {
  forwardForTest,
  setupTrpcServer,
} from "../../../../tests/helpers/trpc-msw";
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

/**
 * 回归：游离 promise 链在卸载后不得再 setState（ISSUE #489）
 * ---------------------------------------------------------------------------
 * 实测形态：`pnpm test` **随机**非零退出（65 轮里 4 轮），用例层面全绿
 * （`Tests N passed / 0 failed`），退出码来自 vitest 的 `Unhandled Errors`：
 *
 *     Unhandled Rejection: ReferenceError: window is not defined
 *       ❯ resolveUpdatePriority  react-dom-client.development.js:1308
 *       ❯ dispatchSetState       react-dom-client.development.js:9126
 *       ❯ use-model-library.ts:58  .finally(() => setLoading(false))
 *
 * 根因：`loadModels` 里 `listQ.refetch().finally(...)` 是一条**脱离组件生命
 * 周期的链**。测试结束后（jsdom 环境已拆除、window 已消失）它才 resolve，
 * 于是 setLoading 触发 React 更新调度、读 window 抛错。`cleanup()` 只卸载组件、
 * 不会取消这条已发出的 promise。
 *
 * 「点名哪个文件」只取决于谁的 MSW handler 回包慢一拍 —— 所以报错文件每次都不同
 * （实测出现过 ModelLibrary.integration / use-model-folder-config / WorkflowEditorInner），
 * 全是被牵连的无辜文件。这也是为什么这条要单独用**确定性**用例守住：
 * 靠全量跑碰上概率太低，没法当门禁。
 *
 * 反向验证：去掉 hook 里的 aliveRef 判定，本用例必挂（卸载后调用计数继续增长）。
 */
describe("useModelLibrary 卸载后不再 setState", () => {
  it("卸载后 refetch 回包不得触发更新调度（原缺陷：React 读到已拆除的 window）", async () => {
    /* 把原来「只在全量并行下偶然出现」的时序变成**必现**：
     * 让 list 的回包卡住到我们显式放行 —— 于是 `.finally` 必然发生在
     * unmount 之后，正是缺陷形态（游离 promise 落在组件生命周期之外）。
     *
     * 判据为什么不是「有没有 unhandled rejection」：卸载后 React 在**仍有
     * jsdom 环境**时能容忍这次更新（静默排掉），只有环境已拆才会抛 ——
     * 而单测里没法在同一个用例内拆掉 jsdom。实测那条路走不通（改坏实现也绿）。
     *
     * 可判定的信号是**更新调度被触发的次数**：React 在没有活动 fiber 时接到
     * setState，会走 `resolveUpdatePriority` 去读 `globalThis.window`。
     * 拿一个记账替身换掉 window，只统计**调用栈含更新调度函数**的读取：
     *
     *   修好（finally 先判 aliveRef）→ 2 次（都来自本次卸载自身的清理）
     *   没修（无条件 setLoading）    → 4 次（多出的两次就是游离 promise 触发的调度）
     *
     * 只统计调度栈、不统计全部读取很重要：ambient 活动（react-query 的
     * focusManager / onlineManager、tRPC 的 getFetch）也会读 window，
     * 全量统计得到的是 7 vs 16，混着与本缺陷无关的噪声。
     *
     * 反向验证：把 finally 改回无条件 `setLoading(false)`，本条必挂。
     */
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
      http.all("*/api/trpc/*", async ({ request }) =>
        forwardForTest(request, gatedRouter),
      ),
    );

    const { result, unmount } = renderHook(() => useModelLibrary(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(listBlocked).toBe(true));
    // 前提成立：回包确实被卡住，finally 还没跑
    expect(result.current.loading).toBe(true);

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
        return realWindow?.value as unknown;
      },
    };
    Object.defineProperty(globalThis, "window", spy);

    let baseline = 0;
    let after = 0;
    try {
      // 基线：卸载前把这一瞬间的调度读取数记下来
      baseline = scheduleReads;
      unmount();
      after = scheduleReads;
      release();
      await new Promise((r) => setTimeout(r, 150));
    } finally {
      if (realWindow) Object.defineProperty(globalThis, "window", realWindow);
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
