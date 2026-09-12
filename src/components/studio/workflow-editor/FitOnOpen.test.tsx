// @vitest-environment jsdom
//
// 「打开工作流 / 子工作流时聚焦到内容」的调度行为 —— ISSUE #394 第二轮。
//
// 上一轮修了「聚焦算得太早」（节点尺寸分批测量），但用户反馈**仍然没聚焦到**。
// 复现出来的真实时序是：
//
//   ① 下钻切到子图 → 聚焦 effect 按新图的 key 排下一帧 rAF；
//   ② 紧接着节点整批同步（`setNodes`）让 `nodes.length` 变化 → 聚焦 effect
//      重跑，cleanup 先取消 ① 里那帧**还没触发**的 rAF；
//   ③ 若「已 fit」记账在**排程时**就写死，第二次进入就被拦住、不再排帧 ——
//      视口于是永远留在上一份图（用户看到的就是打开子工作流停在父工作流
//      的左上角，截图里正是这个画面）。
//
// 本文件用真实 React effect 时序（含 cleanup 与 rAF）锁定修法：记账的单位是
// 「已**下发**过聚焦的图」，排程可以重复、只有真正下发视口后才算聚焦过。

import { act, render } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { describe, expect, it } from "vitest";

import { createFitOnceScheduler } from "./subgraph-viewport";

/** 下等到下一帧 rAF 结束（让聚焦 effect 的 step 真正跑一次）。 */
async function flushFrame() {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

/** 最小复刻 WorkflowEditorInner 的聚焦 effect 形状：
 *  依赖里有会随节点整批同步而抖动的 nodeCount。 */
function FitHarness({
  graphKey,
  nodeCount,
  applied,
}: {
  graphKey: string;
  /** 会随节点整批同步而变化 —— 正是让 effect 重跑、并 cleanup 掉未触发 rAF 的依赖。 */
  nodeCount: number;
  applied: string[];
}) {
  const schedulerRef = useRef<ReturnType<typeof createFitOnceScheduler> | null>(null);
  schedulerRef.current ??= createFitOnceScheduler();

  useEffect(() => {
    if (nodeCount === 0) return;
    const scheduler = schedulerRef.current;
    if (!scheduler?.markPending(graphKey)) return;
    /* 与 WorkflowEditorInner 的同一条约定：视口下发后**且测量收敛**才记账。 */
    let raf = 0;
    const step = () => {
      applied.push(graphKey);
      scheduler.markSettled(graphKey);
    };
    raf = requestAnimationFrame(step);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applied 是测试用的收集数组，身份稳定
  }, [graphKey, nodeCount]);

  return null;
}

describe("打开子图时的自动聚焦调度", () => {
  it("rAF 被 cleanup 取消后仍会重排 —— 切进子图一定下发一次视口", async () => {
    const applied: string[] = [];
    const { rerender } = render(<FitHarness graphKey="__root__" nodeCount={3} applied={applied} />);
    await flushFrame();
    expect(applied).toEqual(["__root__"]);

    /* ① 下钻切到子图：排下一帧 rAF（此刻还没触发）。 */
    await act(async () => {
      rerender(<FitHarness graphKey="4#subgraph:uid" nodeCount={3} applied={applied} />);
    });
    /* ② 同一个 macrotask 内节点整批同步：聚焦 effect 重跑，cleanup 取消 ① 的 rAF。 */
    await act(async () => {
      rerender(<FitHarness graphKey="4#subgraph:uid" nodeCount={90} applied={applied} />);
    });
    await flushFrame();

    /* 被取消的那一次必须补回来 —— 否则就是用户报的「还是没聚焦到」。 */
    expect(applied).toContain("4#subgraph:uid");
  });

  it("同一份图只抢一次视角（下发后不再重复下发）", async () => {
    const applied: string[] = [];
    const { rerender } = render(<FitHarness graphKey="g1" nodeCount={5} applied={applied} />);
    await flushFrame();
    expect(applied).toHaveLength(1);

    /* 用户增删节点：effect 重跑，但这份图已聚焦过，不得再抢视角。 */
    await act(async () => {
      rerender(<FitHarness graphKey="g1" nodeCount={9} applied={applied} />);
    });
    await flushFrame();
    expect(applied).toHaveLength(1);
  });

  it("切到另一份图（子图 → 返回上一级）会重新聚焦", async () => {
    const applied: string[] = [];
    const { rerender } = render(<FitHarness graphKey="g-sub" nodeCount={5} applied={applied} />);
    await flushFrame();

    await act(async () => {
      rerender(<FitHarness graphKey="__root__" nodeCount={12} applied={applied} />);
    });
    await flushFrame();
    expect(applied).toEqual(["g-sub", "__root__"]);
  });
});
