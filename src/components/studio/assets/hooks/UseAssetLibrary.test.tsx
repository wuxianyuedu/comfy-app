// @vitest-environment jsdom
// 「加入资产库」写后失效列表缓存的 hook 级用例（ISSUE #4935）：全局
// staleTime 30s 内，写成功若不失效 asset.list，资产库页会继续显示加入前
// 的旧列表（像「加入了却没进去」）。断言的是编排行为：成功 → 失效列表
// 缓存 + onDone；失败 → 两者都不发生（错误走 toast）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const trpcMocks = vi.hoisted(() => {
  const createFromTaskMutationFn = vi.fn();
  return {
    createFromTaskMutationFn,
    trpcStub: {
      asset: {
        createFromTask: { mutationOptions: () => ({ mutationFn: createFromTaskMutationFn }) },
        list: { queryKey: () => ["asset", "list"] },
      },
    },
  };
});

const toast = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }));

vi.mock("~/trpc/react", () => ({ useTRPC: () => trpcMocks.trpcStub }));
vi.mock("../../ToastProvider", () => ({ useToast: () => toast }));

import { useAddToAssetLibrary } from "./use-asset-library";

describe("useAddToAssetLibrary — 写后失效 asset.list 缓存（ISSUE #4935）", () => {
  let queryClient: QueryClient;
  let invalidateSpy: ReturnType<typeof vi.spyOn>;

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: 30_000, retry: false } },
    });
    invalidateSpy = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    trpcMocks.createFromTaskMutationFn.mockResolvedValue({ created: 1, skipped: 0 });
  });

  it("加入成功后失效 asset.list 缓存，再回调 onDone", async () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useAddToAssetLibrary(onDone), { wrapper });

    let ok = false;
    await act(async () => {
      ok = await result.current.addToLibrary({
        taskId: "t1",
        scope: "public",
        category: "scene",
      });
    });

    expect(ok).toBe(true);
    /* TanStack v5 的 mutationFn 第二参是执行上下文（client/meta），这里只认业务入参。 */
    expect(trpcMocks.createFromTaskMutationFn).toHaveBeenCalledWith(
      { taskId: "t1", scope: "public", category: "scene" },
      expect.anything(),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["asset", "list"] });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("加入失败时不失效缓存、不回调 onDone（错误走 toast）", async () => {
    trpcMocks.createFromTaskMutationFn.mockRejectedValueOnce(new Error("boom"));
    const onDone = vi.fn();
    const { result } = renderHook(() => useAddToAssetLibrary(onDone), { wrapper });

    let ok = true;
    await act(async () => {
      ok = await result.current.addToLibrary({
        taskId: "t1",
        scope: "public",
        category: "scene",
      });
    });

    expect(ok).toBe(false);
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });
});
