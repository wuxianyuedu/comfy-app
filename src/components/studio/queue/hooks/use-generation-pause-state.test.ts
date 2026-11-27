/** useGenerationPauseState 的页签门控契约（#5224 A3 / §2.10.1 自激盲区）：
 *  侧栏常驻 hook 在非当前页签必须停掉 30s 轮询，切回当前页再恢复。
 *  用替身隔离 TanStack 与 tRPC，只断言喂给 queryOptions 的 enabled 门控。 */
import type * as TanStackQuery from "@tanstack/react-query";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const optionsInputs: Array<{ enabled?: boolean; refetchInterval?: number }> = [];
let active = true;

vi.mock("~/trpc/react", () => ({
  useTRPC: () => ({
    generationControl: {
      pauseState: {
        queryOptions: (_input: undefined, options: (typeof optionsInputs)[number]) => {
          optionsInputs.push(options);
          return { queryKey: ["generationControl", "pauseState"] };
        },
      },
    },
  }),
}));

vi.mock("~/components/ui/view-tab-active", () => ({
  useViewTabActive: () => active,
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof TanStackQuery>();
  return {
    ...actual,
    useQuery: (options: { queryKey: Array<string> }) => ({ data: { paused: true }, options }),
  };
});

import { useGenerationPauseState } from "./use-generation-pause-state";

afterEach(() => {
  cleanup();
  optionsInputs.length = 0;
  active = true;
});

describe("useGenerationPauseState", () => {
  it("当前页签：30s 轮询保持 enabled", () => {
    const { result } = renderHook(() => useGenerationPauseState());
    expect(result.current).toBe(true);
    expect(optionsInputs[0]).toEqual({ refetchInterval: 30_000, enabled: true });
  });

  it("非当前页签：enabled=false，后台不再轮询", () => {
    active = false;
    renderHook(() => useGenerationPauseState());
    expect(optionsInputs[0]).toEqual({ refetchInterval: 30_000, enabled: false });
  });
});
