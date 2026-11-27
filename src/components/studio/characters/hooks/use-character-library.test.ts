// @vitest-environment happy-dom
/**
 * 角色库单条取消的行为契约（规范 11 §11.2）：只对「生成中且有 taskId」的行打
 * cancelTask，随后立刻对账；同一条连点只发一次请求。
 */
import type * as TanStackQuery from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cancelTask } from "~/lib/task-cancel-client";

import { useCharacterLibrary } from "./use-character-library";

const syncMutate = vi.fn<(input?: unknown) => Promise<void>>();
const toast = { error: vi.fn(), info: vi.fn(), success: vi.fn() };
const cancelTaskMock = vi.hoisted(() => vi.fn());

let items: Array<{
  id: string;
  name: string;
  status: string;
  taskId: string | null;
}> = [];

vi.mock("~/lib/task-cancel-client", () => ({ cancelTask: cancelTaskMock }));
vi.mock("~/components/studio/ToastProvider", () => ({ useToast: () => toast }));

const stableTrpc = {
  characterLibrary: {
    list: { queryOptions: () => ({ queryKey: ["characterLibrary", "list"] }) },
    detail: { queryOptions: () => ({ queryKey: ["characterLibrary", "detail"] }) },
    history: { queryOptions: () => ({ queryKey: ["characterLibrary", "history"] }) },
    syncGeneration: {
      mutationOptions: () => ({ mutationKey: ["characterLibrary", "syncGeneration"] }),
    },
    delete: { mutationOptions: () => ({ mutationKey: ["characterLibrary", "delete"] }) },
    create: { mutationOptions: () => ({ mutationKey: ["characterLibrary", "create"] }) },
    update: { mutationOptions: () => ({ mutationKey: ["characterLibrary", "update"] }) },
    seed: { mutationOptions: () => ({ mutationKey: ["characterLibrary", "seed"] }) },
    scoreAllQuality: {
      mutationOptions: () => ({ mutationKey: ["characterLibrary", "scoreAllQuality"] }),
    },
    scoreQuality: {
      mutationOptions: () => ({ mutationKey: ["characterLibrary", "scoreQuality"] }),
    },
    regenerateFlagged: {
      mutationOptions: () => ({ mutationKey: ["characterLibrary", "regenerateFlagged"] }),
    },
    deletePortraits: {
      mutationOptions: () => ({ mutationKey: ["characterLibrary", "deletePortraits"] }),
    },
    enqueueGeneration: {
      mutationOptions: () => ({ mutationKey: ["characterLibrary", "enqueueGeneration"] }),
    },
  },
  workflow: { list: { queryOptions: () => ({ queryKey: ["workflow", "list"] }) } },
};

vi.mock("~/trpc/react", () => ({ useTRPC: () => stableTrpc }));

const stableQueryClient = { invalidateQueries: vi.fn() };

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof TanStackQuery>();
  return {
    ...actual,
    useQueryClient: () => stableQueryClient,
    useQuery: (options: { queryKey: Array<unknown> }) => {
      const key = options.queryKey;
      if (key[0] === "characterLibrary" && key[1] === "list") {
        return {
          data: { items, statusCounts: { generating: 0 }, tagFacets: [] },
          isPending: false,
          isFetching: false,
        };
      }
      if (key[0] === "workflow") {
        return { data: { workflows: [] }, isPending: false, isFetching: false };
      }
      if (key[0] === "characterLibrary" && key[1] === "detail") {
        return { data: undefined, isSuccess: false, isFetching: false };
      }
      return { data: [], isSuccess: true, isFetching: false };
    },
    useMutation: (() => {
      const cache = new Map<
        string,
        { isPending: boolean; mutateAsync: ReturnType<typeof vi.fn> }
      >();
      return (options: { mutationKey: Array<unknown> }) => {
        const name = String(options.mutationKey[1]);
        const cached = cache.get(name);
        if (cached !== undefined) {
          return cached;
        }
        const entry = {
          mutateAsync: name === "syncGeneration" ? syncMutate : vi.fn(() => Promise.resolve({})),
          isPending: false,
        };
        cache.set(name, entry);
        return entry;
      };
    })(),
  };
});

const mockedCancel = vi.mocked(cancelTask);

beforeEach(() => {
  vi.clearAllMocks();
  syncMutate.mockResolvedValue(undefined);
  cancelTaskMock.mockResolvedValue(undefined);
  items = [
    {
      id: "char-1",
      name: "雪原法师",
      status: "generating",
      taskId: "task-1",
    },
    {
      id: "char-2",
      name: "待生成角色",
      status: "draft",
      taskId: null,
    },
  ];
});

afterEach(cleanup);

describe("useCharacterLibrary.cancelOne（ISSUE #5098）", () => {
  it("打 cancelTask 后立即对账，非生成中的行不发请求", async () => {
    const { result } = renderHook(() => useCharacterLibrary());

    await act(async () => {
      await result.current.cancelOne("char-2");
    });
    expect(mockedCancel).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.cancelOne("char-1");
    });
    expect(mockedCancel).toHaveBeenCalledTimes(1);
    expect(mockedCancel).toHaveBeenCalledWith("task-1");
    expect(syncMutate).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("同一条连点只发一次取消（防连点判据在 useItemAction）", async () => {
    const { result } = renderHook(() => useCharacterLibrary());
    await act(async () => {
      await Promise.all([result.current.cancelOne("char-1"), result.current.cancelOne("char-1")]);
    });
    expect(mockedCancel).toHaveBeenCalledTimes(1);
    expect(syncMutate).toHaveBeenCalledTimes(1);
  });
});

describe("useCharacterLibrary 传给 memo 卡片的引用稳定性（ISSUE #5198）", () => {
  it("openDetail / openRemove / cancelOne 跨重渲染保持同一引用", () => {
    const { result, rerender } = renderHook(() => useCharacterLibrary());
    const first = {
      cancelOne: result.current.cancelOne,
      openDetail: result.current.openDetail,
      openRemove: result.current.openRemove,
    };
    rerender();
    expect(result.current.cancelOne).toBe(first.cancelOne);
    expect(result.current.openDetail).toBe(first.openDetail);
    expect(result.current.openRemove).toBe(first.openRemove);
  });

  it("selectedCharacterIdSet 随勾选更新，语义与 selectedCharacterIds 一致", () => {
    const { result } = renderHook(() => useCharacterLibrary());
    expect(result.current.selectedCharacterIdSet.size).toBe(0);
    act(() => {
      result.current.toggleCharacterSelection("char-1");
    });
    expect(result.current.selectedCharacterIdSet.has("char-1")).toBe(true);
    expect(result.current.selectedCharacterIds).toContain("char-1");
    act(() => {
      result.current.toggleCharacterSelection("char-1");
    });
    expect(result.current.selectedCharacterIdSet.has("char-1")).toBe(false);
  });
});
