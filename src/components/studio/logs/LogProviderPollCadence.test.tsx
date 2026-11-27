/** E3：日志面板关闭时的后台轮询降到 30s（此前 5s × 6 路 = 静置 12s 18 次请求）。
 * 用假定时器数渲染后到点前发了多少轮 `fetchFileLogSlice`：打开面板维持 2s，
 * 关闭则为 30s；不暂停（启动期日志与 console 中继仍要进库）。 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchSlice = vi.hoisted(() => vi.fn(() => Promise.resolve(null)));

vi.mock("~/lib/log/log-file-client", () => ({ fetchFileLogSlice: fetchSlice }));

import { LogProvider, POLL_IDLE_MS } from "./LogProvider";
import { useLogStore } from "./log-store";

beforeEach(() => {
  vi.useFakeTimers();
  fetchSlice.mockClear();
  useLogStore.setState({ isOpen: false });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("LogProvider 轮询节奏", () => {
  it("面板关闭时 30s 一拍，静置 12s 内只有首拍（不再每 5s 打六路）", async () => {
    expect(POLL_IDLE_MS).toBe(30_000);
    render(<LogProvider>内容</LogProvider>);
    /* 首拍是 immediate，六路各打一次。 */
    await act(async () => {
      await Promise.resolve();
    });
    const afterMount = fetchSlice.mock.calls.length;
    expect(afterMount).toBeGreaterThan(0);

    await advance(12_000);
    expect(fetchSlice.mock.calls.length, "12s 静置不该再发起新的一轮").toBe(afterMount);

    await advance(18_000);
    expect(fetchSlice.mock.calls.length, "到 30s 才再打一轮").toBeGreaterThan(afterMount);
  });

  it("面板打开时维持 2s 的实时节奏", async () => {
    useLogStore.setState({ isOpen: true });
    render(<LogProvider>内容</LogProvider>);
    await act(async () => {
      await Promise.resolve();
    });
    const afterMount = fetchSlice.mock.calls.length;

    await advance(4000);
    expect(fetchSlice.mock.calls.length - afterMount, "2s 一拍：4s 内应又跑了两轮").toBe(12);
  });
});
