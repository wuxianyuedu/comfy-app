// @vitest-environment jsdom
/** E2：`useDevServerLiveness` 的 2s 探活在隐藏页签停摆、切回立即补一拍。
 * 状态栏在所有页签常驻挂载，若探活不认页签可见性，多开页签时会有额外空转；
 * 这条钉住 `useInterval` 的 `pauseWhenViewHidden` 在探活这一路的落地。 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEV_SERVER_PROBE_MS, useDevServerLiveness } from "./use-dev-server-liveness";
import { ViewTabActiveProvider } from "~/components/ui/view-tab-active";

const serverIdFetch = vi.hoisted(() => vi.fn());
/** 页签可见性测试台：包一层 Provider，按需翻转「本屏是不是当前页」。 */
function createHarness(initialActive: boolean) {
  let setActive: (active: boolean) => void = () => undefined;
  function Wrapper({ children }: { children: ReactNode }) {
    const [active, setActiveState] = useState(initialActive);
    setActive = setActiveState;
    return <ViewTabActiveProvider active={active}>{children}</ViewTabActiveProvider>;
  }
  return {
    Wrapper,
    toggle: (active: boolean) => {
      setActive(active);
    },
  };
}

beforeEach(() => {
  serverIdFetch.mockReset();
  serverIdFetch.mockResolvedValue(
    new Response(JSON.stringify({ bootId: "boot-1", runId: "run-1" }), { status: 200 }),
  );
  vi.stubGlobal("fetch", serverIdFetch);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useDevServerLiveness：隐藏页签停摆（E2）", () => {
  it("不是当前页签时探活不空转；切回立即补一拍", async () => {
    vi.useFakeTimers();
    const harness = createHarness(false);
    renderHook(() => useDevServerLiveness(), { wrapper: harness.Wrapper });

    expect(serverIdFetch.mock.calls.length, "隐藏页签挂载即停摆").toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEV_SERVER_PROBE_MS * 4);
    });
    expect(serverIdFetch.mock.calls.length, "隐藏页签不该再按 2s 空转").toBe(0);

    act(() => {
      harness.toggle(true);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(serverIdFetch.mock.calls.length, "切回当前页立即补一拍").toBeGreaterThan(0);
  });
});
