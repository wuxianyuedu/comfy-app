// @vitest-environment jsdom
// `useSimulatedProgress` 的引用纪律与可见性判据（ISSUE #4559）：
// 进度定时器每 1.5s 跑一拍 —— 没有值变化时必须保住旧引用（整页静止卡不陪跑），
// 页面不可见时暂停（与仓内其它轮询的 pauseWhenHidden 口径对齐）。
// 时间线用假定时器控制；「切后台暂停」只有拿捏住 visibilityState 才验得了
//（手法与 use-interval.test.ts 同款）。
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskItem } from "./history-types";
import { useSimulatedProgress } from "./history-utils";

beforeEach(() => {
  vi.useFakeTimers();
  /* 确定性：起步值与每拍增量都定下来（12 + 0.5*25 起步、每拍 +0.5*5）。 */
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
});

function makeTask(id: string, status: string): TaskItem {
  return {
    cover: null,
    createdAt: new Date().toISOString(),
    id,
    prompt: "一只猫",
    status,
    type: "txt2img",
    workflowName: "测试工作流",
  };
}

/** 把 `document.visibilityState` 置成指定值并派发一次 visibilitychange。 */
function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useSimulatedProgress（ISSUE #4559）", () => {
  it("RUNNING 任务每拍推进，值变化时换引用", async () => {
    const { result } = renderHook(() => useSimulatedProgress([makeTask("a", "RUNNING")]));
    expect(result.current, "immediate=false：挂载不先跑").toEqual({});

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    const first = result.current;
    expect(first.a).toBeCloseTo(27, 5);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(result.current.a!).toBeGreaterThan(first.a!);
    expect(result.current, "值变了才换引用").not.toBe(first);
  });

  it("RUNNING 任务封顶 95% 后不再换引用（静止页不陪跑）", async () => {
    const { result } = renderHook(() => useSimulatedProgress([makeTask("a", "RUNNING")]));
    /* 起步 24.5、每拍 +2.5：约 29 拍封顶，跑 40 拍确保越过分水岭。 */
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500 * 40);
    });
    expect(result.current.a).toBe(95);

    const stable = result.current;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500 * 5);
    });
    expect(result.current, "封顶后每拍算出的还是 95，不该再造新对象").toBe(stable);
  });

  it("任务不再 RUNNING 时把它的条目清掉（引用随之更新）", async () => {
    const { result, rerender } = renderHook(
      (props: { tasks: Array<TaskItem> }) => useSimulatedProgress(props.tasks),
      { initialProps: { tasks: [makeTask("a", "RUNNING")] } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(result.current.a).toBeDefined();

    rerender({ tasks: [makeTask("a", "SUCCEEDED")] });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(result.current.a).toBeUndefined();
  });

  it("页面不可见时暂停，回前台恢复推进（默认 pauseWhenHidden）", async () => {
    const { result } = renderHook(() => useSimulatedProgress([makeTask("a", "RUNNING")]));

    act(() => {
      setVisibility("hidden");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(result.current, "后台不该继续推进").toEqual({});

    act(() => {
      setVisibility("visible");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(result.current.a, "回前台恢复推进").toBeDefined();
  });
});
