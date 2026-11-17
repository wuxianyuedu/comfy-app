/**
 * 系列组织者 controller 的失败反馈（#4233）：本 hook 的 18 个 mutation 此前只有
 * onSuccess——请求失败时界面毫无反应（删除看似成功但列表还在、整季批量生成看似
 * 开始但永远没有进度）。钉三件事：失败落 toast 且文案带动作前缀 + 网络层原因
 * （errorText 唯一出口）；成功路径不说话；整季批量生成这个长任务入口失败必报。
 *
 * TanStack 用真实现（React Query 的 mutation 状态机是行为的一半）；`useTRPC` 给一个
 * 能过类型面的代理工厂——`mutationOptions` 注入按用例成败切换的 `mutationFn`，
 * `queryOptions`/`queryFilter` 只给能对上形状的空壳（本文件的题目不是查询）。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSeriesOrganizer } from "./use-series-organizer";

const backend = vi.hoisted(() => ({
  /** 桩的 mutationFn 是否拒绝；error 按用例换。 */
  reject: false,
  error: new Error("db busy"),
}));

const toast = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }));

vi.mock("~/components/studio/ToastProvider", () => ({ useToast: () => toast }));

vi.mock("~/trpc/react", () => ({
  useTRPC: () =>
    new Proxy(
      {},
      {
        /* 两层代理 = trpc.<domain>.<proc>；只造本文件用得到的三个工厂。 */
        get: (_t, domain: string) =>
          new Proxy(
            {},
            {
              get: (_t2, proc: string) => ({
                mutationOptions: (opts: Record<string, unknown>) => ({
                  ...opts,
                  mutationFn: () =>
                    backend.reject ? Promise.reject(backend.error) : Promise.resolve({}),
                }),
                queryOptions: () => ({ queryKey: [domain, proc] }),
                queryFilter: () => ({ queryKey: [domain, proc] }),
              }),
            },
          ),
      },
    ),
}));

let queryClient: QueryClient;

function renderOrganizer() {
  return renderHook(() => useSeriesOrganizer("proj-1"), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  backend.reject = false;
  backend.error = new Error("db busy");
  toast.error.mockClear();
  toast.info.mockClear();
});

afterEach(cleanup);

describe("useSeriesOrganizer 的失败反馈（#4233）", () => {
  it("删除系列失败：toast.error 带动作前缀与网络层原因，不再静默", async () => {
    backend.reject = true;
    const { result } = renderOrganizer();

    await act(async () => {
      result.current.deleteSeries("s1");
      await Promise.resolve();
    });

    expect(toast.error).toHaveBeenCalledTimes(1);
    const msg = String(toast.error.mock.calls[0]?.[0]);
    expect(msg).toContain("删除系列失败");
    expect(msg).toContain("db busy");
  });

  it("整季批量生成（长任务入口）失败必报：文案带「整季生成」", async () => {
    backend.reject = true;
    const { result } = renderOrganizer();
    act(() => {
      result.current.selectSeason("season-1");
    });

    await act(async () => {
      result.current.batchGenerateSeason("wf-1");
      await Promise.resolve();
    });

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(String(toast.error.mock.calls[0]?.[0])).toContain("整季生成");
  });

  it("成功路径不说话（只走各自的 onSuccess 失效重拉）", async () => {
    const { result } = renderOrganizer();

    await act(async () => {
      result.current.deleteSeries("s1");
      result.current.createSeason("s1", "第一季");
      result.current.createCharacter("s1", "角色");
      await Promise.resolve();
    });

    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });
});
