// @vitest-environment jsdom
/**
 * useAssetLibrary 搜索防抖的行为契约（ISSUE #5205）：输入框显示即时，
 * 喂给 asset.list 查询的 q 降频（停止变化 250ms 后才跟上）。
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** 每次列表查询实际喂给 queryOptions 的入参（断言防抖用）。 */
const listQueryInputs: Array<{ q?: string }> = [];

const trpcStub = {
  asset: {
    list: {
      queryOptions: (input: { q?: string }) => {
        listQueryInputs.push(input);
        return { queryKey: ["asset", "list"] };
      },
      queryKey: () => ["asset", "list"],
    },
    detail: { queryOptions: () => ({ queryKey: ["asset", "detail"] }) },
    delete: { mutationOptions: () => ({ mutationKey: ["asset", "delete"] }) },
  },
};
const toast = { info: vi.fn(), error: vi.fn(), success: vi.fn() };

vi.mock("~/trpc/react", () => ({ useTRPC: () => trpcStub }));
vi.mock("../../ToastProvider", () => ({ useToast: () => toast }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: () => ({ data: undefined, isSuccess: false, isPending: false, isFetching: false }),
  useMutation: () => ({ mutateAsync: vi.fn(() => Promise.resolve({})), isPending: false }),
}));

import { useAssetLibrary } from "./use-asset-library";

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  listQueryInputs.length = 0;
});

describe("useAssetLibrary 搜索防抖（ISSUE #5205）", () => {
  it("输入框即时更新，但喂给 list 查询的 q 在防抖窗口内保持旧值、窗口后才跟上", async () => {
    const { result } = renderHook(() => useAssetLibrary());
    /* 首帧用空 q 查过一次。 */
    expect(listQueryInputs.at(-1)?.q).toBeUndefined();

    act(() => {
      result.current.setQ("赛");
    });
    expect(result.current.q).toBe("赛");
    expect(listQueryInputs.at(-1)?.q).toBeUndefined();

    act(() => {
      result.current.setQ("赛博");
      result.current.setQ("赛博朋克");
    });
    expect(result.current.q).toBe("赛博朋克");
    expect(listQueryInputs.at(-1)?.q).toBeUndefined();

    await expect
      .poll(() => listQueryInputs.at(-1)?.q, { message: "防抖窗口后列表查询应只拿到最后一次 q" })
      .toBe("赛博朋克");
  });
});
