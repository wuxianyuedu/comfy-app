// @vitest-environment jsdom
// 工作流库逻辑层单测：hook 走真实 tRPC React 客户端（api.workflow.* /
// api.workflowModel.list），由 MSW 转发到可控测试 router —— 因此断言的是
// **真实管线下的 loading → data → 错误流转**，而不是 vi.mock 的永不 resolve 桩。
//
// 三个重点：
//   1. 三级筛选 + 搜索的派生（纯规则在 workflow-library-config.test.ts）；
//   2. 服务端列表 → 本地 state 的同步（快照比对，同一份数据不重复 setState）；
//   3. §17.5.4：动作失败的错误不会被后台刷新吞掉（只有 refresh 才清）。

import { createElement, type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { httpBatchStreamLink } from "@trpc/client";
import { TRPCError } from "@trpc/server";
import SuperJSON from "superjson";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createTestQueryClient } from "../../../../../tests/helpers/renderWithProviders";
import { createTestTRPC } from "../../../../../tests/helpers/test-trpc";
import { setupTrpcServer } from "../../../../../tests/helpers/trpc-msw";
import { api } from "~/trpc/react";

import type { PendingRow, WorkflowRow } from "../workflow-library-config";
import { LIST_STALL_MS, useWorkflowLibrary } from "./use-workflow-library";

const toast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  toast: vi.fn(),
  loading: vi.fn(),
  update: vi.fn(),
  dismiss: vi.fn(),
};

vi.mock("../../ToastProvider", () => ({
  useToast: () => toast,
}));

/** 可控的「服务端」行为。 */
interface Behavior {
  workflows: Record<string, unknown>[];
  localPending: Record<string, unknown>[];
  tags: { id: string; name: string; count: number }[];
  /** 非空时 workflow.list 抛错 —— 覆盖加载错误通道 */
  listError?: string;
  /** 非空时 workflow.update 抛错 —— 覆盖动作错误通道 */
  updateError?: string;
  /** 非空时 workflow.delete 抛错 —— 覆盖 §17.5.4 的动作错误通道 */
  deleteError?: string;
  /** workflow.list 延迟多少毫秒才 resolve，模拟后端扫描卡住。 */
  listDelayMs?: number;
}

let behavior: Behavior = { workflows: [], localPending: [], tags: [] };
let listCalls = 0;

const t = createTestTRPC();
const mockRouter = t.router({
  workflow: t.router({
    list: t.procedure.query(async () => {
      listCalls += 1;
      if (behavior.listDelayMs && behavior.listDelayMs > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, behavior.listDelayMs),
        );
      }
      if (behavior.listError) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: behavior.listError,
        });
      }
      return {
        workflows: behavior.workflows,
        localPending: behavior.localPending,
      };
    }),
    create: t.procedure.mutation(() => ({ id: "new", warnings: [] })),
    update: t.procedure.mutation(() => {
      if (behavior.updateError) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: behavior.updateError,
        });
      }
      return { ok: true };
    }),
    delete: t.procedure.mutation(() => {
      if (behavior.deleteError) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: behavior.deleteError,
        });
      }
      return { ok: true };
    }),
    resync: t.procedure.mutation(() => ({ ok: true, updated: true })),
  }),
  workflowModel: t.router({
    list: t.procedure.query(() => ({ tags: behavior.tags })),
  }),
});

const server = setupTrpcServer(mockRouter);

function row(overrides: Partial<WorkflowRow> = {}): Record<string, unknown> {
  return {
    id: "wf-1",
    name: "demo",
    taskType: "T2I",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

function pending(overrides: Partial<PendingRow> = {}): Record<string, unknown> {
  return {
    id: "p-1",
    name: "pending.json",
    sourcePath: "D:/x/pending.json",
    ...overrides,
  };
}

/** hook 用到 api.*，必须挂在真实 tRPC Provider 下（同 use-model-library.test.ts）。 */
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
      // eslint-disable-next-line react/no-children-prop -- createElement 的第三参即 children
      createElement(api.Provider, { client, queryClient: qc, children }),
    );
  };
}

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  cleanup();
  behavior = { workflows: [], localPending: [], tags: [] };
  listCalls = 0;
  vi.clearAllMocks();
  server.resetHandlers();
});
afterAll(() => server.close());

describe("useWorkflowLibrary", () => {
  it("挂载后拿到列表与标签，并派生出来源 / 类型计数", async () => {
    behavior = {
      workflows: [
        row({ id: "1", name: "Alpha", sourcePath: "D:/a.json" }),
        row({ id: "2", name: "Beta", taskType: "I2V" }),
      ],
      localPending: [pending()],
      tags: [{ id: "t1", name: "flux", count: 2 }],
    };
    const { result } = renderHook(() => useWorkflowLibrary(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.workflows).toHaveLength(2));
    expect(result.current.pendingRows).toHaveLength(1);
    expect(result.current.sourceCounts).toEqual({
      all: 3,
      local: 2,
      online: 1,
    });
    expect(result.current.typeCounts).toEqual({
      all: 3,
      image: 1,
      video: 1,
      audio: 0,
    });
    expect(result.current.modelTags).toEqual([
      { id: "t1", name: "flux", count: 2 },
    ]);
  });

  it("筛选与搜索都是本地派生，不打新请求", async () => {
    behavior = {
      workflows: [
        row({ id: "1", name: "Alpha", taskType: "T2I", modelTags: ["flux"] }),
        row({ id: "2", name: "Beta", taskType: "I2V" }),
      ],
      localPending: [],
      tags: [],
    };
    const { result } = renderHook(() => useWorkflowLibrary(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.workflows).toHaveLength(2));

    const callsBefore = listCalls;
    act(() => result.current.setTypeFilter("video"));
    expect(result.current.workflows.map((workflow) => workflow.id)).toEqual([
      "2",
    ]);

    act(() => result.current.setTypeFilter("all"));
    act(() => result.current.setModelFilter("flux"));
    expect(result.current.workflows.map((workflow) => workflow.id)).toEqual([
      "1",
    ]);

    act(() => result.current.setModelFilter("all"));
    act(() => result.current.setSearch("beta"));
    expect(result.current.workflows.map((workflow) => workflow.id)).toEqual([
      "2",
    ]);

    expect(listCalls).toBe(callsBefore);
  });

  it("选中项随列表联动；删除被选中项时清空选择", async () => {
    behavior = {
      workflows: [
        row({ id: "1", name: "Alpha" }),
        row({ id: "2", name: "Beta" }),
      ],
      localPending: [],
      tags: [],
    };
    const { result } = renderHook(() => useWorkflowLibrary(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.workflows).toHaveLength(2));

    act(() => result.current.setSelectedId("2"));
    expect(result.current.selectedRow?.name).toBe("Beta");

    act(() => result.current.handleDeleteClick("2", "Beta"));
    expect(result.current.selectedId).toBeNull();
    expect(result.current.pendingDelete).toEqual({ id: "2", name: "Beta" });

    // 删除未选中项不该动选择
    act(() => result.current.setSelectedId("1"));
    act(() => result.current.handleDeleteClick("2", "Beta"));
    expect(result.current.selectedId).toBe("1");
  });

  it("loadError：列表拉取失败有出口，重新拉取成功后自动消失", async () => {
    behavior = { ...behavior, listError: "数据库不可用" };
    const { result } = renderHook(() => useWorkflowLibrary(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() =>
      expect(result.current.loadError).toContain("数据库不可用"),
    );

    behavior = { workflows: [row()], localPending: [], tags: [] };
    await act(async () => {
      result.current.load();
    });
    await waitFor(() => expect(result.current.loadError).toBeNull());
  });

  it("§17.5.4：动作失败的错误不会被随后的列表刷新吞掉", async () => {
    behavior = {
      workflows: [row({ id: "1" })],
      localPending: [],
      tags: [],
      deleteError: "删除失败：文件被占用",
    };
    const { result } = renderHook(() => useWorkflowLibrary(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.workflows).toHaveLength(1));

    await act(async () => {
      await result.current.confirmDelete("1");
    });
    expect(result.current.actionError).toBe("删除失败：文件被占用");

    // 关键点：后台刷新成功，动作错误必须还在（否则提示条一闪就没，
    // 用户会以为删除成功了 —— §17.5.4 记录的就是这个坑）。
    behavior = { ...behavior, deleteError: undefined };
    await act(async () => {
      result.current.load();
    });
    await waitFor(() => expect(result.current.workflows).toHaveLength(1));
    expect(result.current.actionError).toBe("删除失败：文件被占用");

    // 只有用户点「重试」才清
    act(() => {
      result.current.refresh();
    });
    expect(result.current.actionError).toBeNull();
  });

  it("动作成功后不残留错误", async () => {
    behavior = { workflows: [row({ id: "1" })], localPending: [], tags: [] };
    const { result } = renderHook(() => useWorkflowLibrary(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.workflows).toHaveLength(1));

    await act(async () => {
      await result.current.confirmDelete("1");
    });
    expect(result.current.actionError).toBeNull();
    expect(result.current.pendingDelete).toBeNull();
  });

  it("首次拉取卡住超过 LIST_STALL_MS 后 loadStalled 变为 true", async () => {
    // 用 fake timers 模拟后端延迟，避免测试真实等待 8 秒。
    // 注意：useFakeTimers 会影响 React Query 内部计时器，因此在本用例内启用并在
    // 结束后还原。
    vi.useFakeTimers();
    behavior = {
      workflows: [],
      localPending: [],
      tags: [],
      listDelayMs: LIST_STALL_MS + 2_000,
    };

    const { result } = renderHook(() => useWorkflowLibrary(), {
      wrapper: makeWrapper(),
    });

    // 初始状态：正在加载，但还没触发 stalled 判定
    expect(result.current.loading).toBe(true);
    expect(result.current.loadStalled).toBe(false);

    // 推进到刚好触发 stalled 超时
    await act(async () => {
      vi.advanceTimersByTime(LIST_STALL_MS + 50);
    });

    // 关键点：超过 LIST_STALL_MS 后，必须给用户可操作的「加载较久」出口，
    // 而不是一直显示 spinner 假装还在正常加载。
    expect(result.current.loadStalled).toBe(true);
    expect(result.current.loading).toBe(true);

    vi.useRealTimers();
  });
});
