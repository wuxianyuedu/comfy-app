import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QueueRow } from "../queue-monitor-config";
import { refreshComfyQueue } from "~/lib/comfy/comfy-queue-store";
import { useQueueMonitor } from "./use-queue-monitor";

type ListInput = { status?: string; take: number };
type ListPage = { hasMore: boolean; nextScanCursor: number; tasks: Array<QueueRow>; total: number };
type PageRequest = { pageParam: number };

const listPage = vi.fn<(request: PageRequest) => Promise<ListPage>>();

function row(index: number): QueueRow {
  return {
    id: `task-${String(index)}`,
    type: "IMAGE",
    workflowName: `工作流 ${String(index)}`,
    modelName: "测试模型",
    status: "SUCCEEDED",
    prompt: "测试提示词",
    createdAt: new Date(0),
    claimedAt: null,
    finishedAt: new Date(1),
    queuePosition: null,
    cover: null,
    checkpoint: null,
    videoPath: null,
    mediaType: "image",
    projectId: null,
    progress: 100,
    error: null,
  };
}

vi.mock("~/trpc/react", () => ({
  useTRPCClient: () => ({ task: { list: { query: () => listPage({ pageParam: 0 }) } } }),
  useTRPC: () => ({
    task: {
      list: {
        queryKey: (input?: ListInput) =>
          input === undefined
            ? [["task", "list"], { type: "query" }]
            : [["task", "list"], { input, type: "query" }],
        infiniteQueryFilter: () => ({
          queryKey: [["task", "list"], { type: "infinite" }],
        }),
        infiniteQueryKey: (input: ListInput) => [["task", "list"], { input, type: "infinite" }],
        infiniteQueryOptions: (input: ListInput, options: object) => ({
          ...options,
          initialPageParam: 0,
          queryFn: listPage,
          queryKey: [["task", "list"], { input, type: "infinite" }],
        }),
      },
      summary: {
        queryOptions: (input: { todayStartedAt: string }, options: object) => ({
          ...options,
          queryFn: () =>
            Promise.resolve({ failedToday: 0, queued: 0, running: 0, succeededToday: 0 }),
          queryKey: ["task", "summary", input],
        }),
      },
      detail: {
        queryOptions: (input: { id: string }, options: object) => ({
          ...options,
          queryFn: () => Promise.resolve(null),
          queryKey: ["task", "detail", input],
        }),
      },
    },
  }),
}));

vi.mock("~/components/studio/hooks/use-comfy-queue", () => ({
  COMFY_QUEUE_POLL_MS: 60_000,
  useComfyQueue: () => ({
    comfy: { pending: 0, running: 0 },
    elapsedMs: 0,
    online: true,
    queued: 0,
    running: null,
    syncedAt: 1,
  }),
}));

vi.mock("~/components/ui/view-tab-active", () => ({ useViewTabActive: () => true }));
vi.mock("~/components/studio/ToastProvider", () => ({
  useToast: () => ({ error: vi.fn(), info: vi.fn() }),
}));
vi.mock("~/lib/comfy/comfy-queue-store", () => ({ refreshComfyQueue: vi.fn() }));

function renderMonitor() {
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: 0, retry: false, staleTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return renderHook(() => useQueueMonitor(), { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  listPage.mockImplementation(({ pageParam }) =>
    Promise.resolve({
      hasMore: pageParam === 0,
      nextScanCursor: 60,
      tasks: Array.from({ length: pageParam === 0 ? 60 : 1 }, (_, index) =>
        row(pageParam + index + 1),
      ),
      total: 61,
    }),
  );
  vi.mocked(refreshComfyQueue).mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("队列分页刷新", () => {
  it("加载第二页后手动刷新丢弃旧 pageParams，只保留第一页", async () => {
    const { result } = renderMonitor();
    await expect.poll(() => result.current.loadedCount).toBe(60);

    act(() => {
      result.current.loadMore();
    });
    await expect.poll(() => result.current.loadedCount).toBe(61);
    expect(result.current.hasMore).toBe(false);

    act(() => {
      result.current.refresh();
    });
    await expect
      .poll(() => {
        if (result.current.refreshing || result.current.loadedCount !== 60) {
          return false;
        }
        return true;
      })
      .toBe(true);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.total).toBe(61);
    expect(result.current.refreshError).toBeNull();
    expect(listPage.mock.calls.map(([request]) => request.pageParam)).toEqual([0, 60, 0]);
  });

  it("第一页刷新失败时保留上一份两页快照", async () => {
    const { result } = renderMonitor();
    await expect.poll(() => result.current.loadedCount).toBe(60);
    act(() => {
      result.current.loadMore();
    });
    await expect.poll(() => result.current.loadedCount).toBe(61);
    expect(result.current.hasMore).toBe(false);

    listPage.mockRejectedValueOnce(new Error("first page unavailable"));
    act(() => {
      result.current.refresh(true);
    });
    await expect.poll(() => result.current.refreshing).toBe(false);

    expect(result.current.loadedCount).toBe(61);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.refreshError).toContain("未完整同步");
    expect(result.current.loadedCount).toBe(61);
    expect(result.current.matchedCount).toBe(61);
    expect(listPage.mock.calls.map(([request]) => request.pageParam)).toEqual([0, 60, 0]);
  });
});
