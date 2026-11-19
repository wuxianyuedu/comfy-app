// 「打开工作流 / 子工作流时聚焦到内容」的调度 —— ISSUE #394 第二轮。
// 节点整批同步让 `nodes.length` 变化 → 聚焦 effect 重跑，cleanup 会取消上一轮
// **还没触发**的 rAF；若「已 fit」在排程时就写死，第二次进入被拦住、视口停在上一份
// 图（打开子工作流停在父工作流左上角）。故记账单位是「已**下发**过聚焦的图」，
// 排程可重复，只有真正下发视口后才算聚焦过。

import { act, render } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { describe, expect, it } from "vitest";

import { createFitOnceScheduler } from "./subgraph-viewport";

/** 下等到下一帧 rAF 结束（让聚焦 effect 的 step 真正跑一次）。 */
async function flushFrame() {
  await act(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => {
        resolve();
      }),
    );
  });
}

/** 最小复刻 WorkflowEditorInner 的聚焦 effect 形状：
 *  依赖里有会随节点整批同步而抖动的 nodeCount。 */
function FitHarness({
  graphKey,
  nodeCount,
  applied,
}: {
  applied: Array<string>;
  graphKey: string;
  /** 会随节点整批同步而变化 —— 正是让 effect 重跑、并 cleanup 掉未触发 rAF 的依赖。 */
  nodeCount: number;
}) {
  const schedulerRef = useRef<ReturnType<typeof createFitOnceScheduler> | null>(null);
  schedulerRef.current ??= createFitOnceScheduler();

  useEffect(() => {
    if (nodeCount === 0) {
      return;
    }
    const scheduler = schedulerRef.current;
    if (scheduler?.markPending(graphKey) !== true) {
      return;
    }
    /* 与 WorkflowEditorInner 的同一条约定：视口下发后**且测量收敛**才记账。 */
    let raf = 0;
    const step = () => {
      applied.push(graphKey);
      scheduler.markSettled(graphKey);
    };
    raf = requestAnimationFrame(step);
    return () => {
      if (raf) {
        cancelAnimationFrame(raf);
      }
    };
    // oxlint-disable-next-line react/exhaustive-deps -- applied 是测试用的收集数组，身份稳定
  }, [graphKey, nodeCount]);

  return null;
}

describe("打开子图时的自动聚焦调度", () => {
  it("rAF 被 cleanup 取消后仍会重排 —— 切进子图一定下发一次视口", async () => {
    const applied: Array<string> = [];
    const { rerender } = render(<FitHarness applied={applied} graphKey="__root__" nodeCount={3} />);
    await flushFrame();
    expect(applied).toEqual(["__root__"]);

    /* ① 下钻切到子图：排下一帧 rAF（此刻还没触发）。 */
    act(() => {
      rerender(<FitHarness applied={applied} graphKey="4#subgraph:uid" nodeCount={3} />);
    });
    /* ② 同一个 macrotask 内节点整批同步：聚焦 effect 重跑，cleanup 取消 ① 的 rAF。 */
    act(() => {
      rerender(<FitHarness applied={applied} graphKey="4#subgraph:uid" nodeCount={90} />);
    });
    await flushFrame();

    /* 被取消的那一次必须补回来 —— 否则就是用户报的「还是没聚焦到」。 */
    expect(applied).toContain("4#subgraph:uid");
  });

  it("同一份图只抢一次视角（下发后不再重复下发）", async () => {
    const applied: Array<string> = [];
    const { rerender } = render(<FitHarness applied={applied} graphKey="g1" nodeCount={5} />);
    await flushFrame();
    expect(applied).toHaveLength(1);

    /* 用户增删节点：effect 重跑，但这份图已聚焦过，不得再抢视角。 */
    act(() => {
      rerender(<FitHarness applied={applied} graphKey="g1" nodeCount={9} />);
    });
    await flushFrame();
    expect(applied).toHaveLength(1);
  });

  it("切到另一份图（子图 → 返回上一级）会重新聚焦", async () => {
    const applied: Array<string> = [];
    const { rerender } = render(<FitHarness applied={applied} graphKey="g-sub" nodeCount={5} />);
    await flushFrame();

    act(() => {
      rerender(<FitHarness applied={applied} graphKey="__root__" nodeCount={12} />);
    });
    await flushFrame();
    expect(applied).toEqual(["g-sub", "__root__"]);
  });
});
