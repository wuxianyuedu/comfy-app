// @vitest-environment happy-dom
/** 活动流轮询（ISSUE #5251）：挂载即取、30s 再取、无项目不装表。 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchProjectActivity: vi.fn() }));
vi.mock("~/lib/production/activity-client", () => ({
  fetchProjectActivity: mocks.fetchProjectActivity,
}));

import { useProjectActivity } from "./use-project-activity";

beforeEach(() => {
  vi.useFakeTimers();
  mocks.fetchProjectActivity.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useProjectActivity", () => {
  it("挂载即取一次，30s 后自动再取", async () => {
    const { unmount } = renderHook(() => useProjectActivity("proj_1"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.fetchProjectActivity).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(mocks.fetchProjectActivity).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("无项目时不装表、不发请求", async () => {
    const { unmount } = renderHook(() => useProjectActivity(undefined));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mocks.fetchProjectActivity).not.toHaveBeenCalled();
    unmount();
  });
});
