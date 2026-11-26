import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

import { RunningTiming } from "./RunningTiming";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/* 耗时文案从 controller 下沉到富卡本地计时后的行为判据：
 * 秒表起点 + 进度原值决定三格读数，不依赖整页 controller 的 elapsedMs。 */
describe("RunningTiming（队列秒表下沉）", () => {
  it("进度为 0 时剩余写「估算中」，不编一个百分比推算", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    render(
      <RunningTiming
        progressPct={0}
        progressValue={null}
        startedAt={Date.parse("2026-01-01T00:00:00Z")}
        stepsText="—"
      />,
    );
    expect(screen.getByText("估算中")).toBeTruthy();
  });

  it("已耗时 + 百分比外推剩余，步数按 value/max 给出", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:01:00Z"));
    render(
      <RunningTiming
        progressPct={25}
        progressValue={2049}
        startedAt={Date.parse("2026-01-01T00:00:00Z")}
        stepsText="2049/8196"
      />,
    );
    expect(screen.getByText("约 03:00")).toBeTruthy();
    expect(screen.getByText("2049/8196")).toBeTruthy();
    expect(screen.getByText("34.15 it/s")).toBeTruthy();
  });

  it("秒表推进只更新本卡片读数（不触发整页轮询）", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    render(
      <RunningTiming
        progressPct={0}
        progressValue={null}
        startedAt={Date.parse("2026-01-01T00:00:00Z")}
        stepsText="—"
      />,
    );
    expect(screen.getByText("00:00")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("00:01")).toBeTruthy();
  });
});
