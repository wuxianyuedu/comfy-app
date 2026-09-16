// 子工作流打开时的「聚焦到有节点的位置」计算 —— ISSUE #394
//
// 这组用例锁定的都是子图里才暴露的形态：
//   · 首帧 measured 全为 0（节点还没测量完）—— 旧实现照常用 0×0 参与包围盒，
//     算出远小于实际内容的框 → 视口停在空白处；
//   · 折叠 / 视口裁剪下的节点没有实测尺寸 —— 必须退到节点声明的 style 尺寸；
//   · 视口为 0（jsdom / 未布局）时不能算出 Infinity / NaN 视口。

import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_FIT_ZOOM,
  createFitOnceScheduler,
  createFitSettleStepper,
  DEFAULT_MIN_FIT_ZOOM,
  computeFitViewport,
  normalizeBounds,
  type FitBoundsNode,
} from "./subgraph-viewport";

const FALLBACK = { width: 240, height: 80 };
const CONTAINER = { width: 1200, height: 700 };

/** 造一个「未测量」的节点（首帧 / 被视口裁剪）。 */
function unmeasured(x: number, y: number, w: number, h: number): FitBoundsNode {
  return {
    position: { x, y },
    measured: { width: 0, height: 0 },
    style: { width: w, height: h },
  };
}

describe("normalizeBounds", () => {
  it("全部未测量时退回节点声明的 style 尺寸，而不是 0×0 包围盒", () => {
    const bounds = normalizeBounds(
      [
        unmeasured(1000, 2000, 210, 90),
        unmeasured(1400, 2400, 270, 120),
        unmeasured(600, 2600, 240, 80),
      ],
      FALLBACK,
    );

    // 真实内容范围：x 600→1670，y 2000→2680
    expect(bounds).toEqual({ minX: 600, maxX: 1670, minY: 2000, maxY: 2680 });
  });

  it("实测尺寸优先于声明尺寸", () => {
    const bounds = normalizeBounds(
      [
        {
          position: { x: 0, y: 0 },
          measured: { width: 300, height: 100 },
          style: { width: 1, height: 1 },
        },
      ],
      FALLBACK,
    );

    expect(bounds).toEqual({ minX: 0, maxX: 300, minY: 0, maxY: 100 });
  });

  it("折叠态节点 measured 只剩标题条时用声明尺寸兜底", () => {
    const collapsed: FitBoundsNode = {
      position: { x: 0, y: 0 },
      measured: { width: 0, height: 0 },
      style: { width: 400, height: 300 },
    };

    expect(normalizeBounds([collapsed], FALLBACK)).toEqual({
      minX: 0,
      maxX: 400,
      minY: 0,
      maxY: 300,
    });
  });

  it("既无实测也无声明 → 用兜底尺寸，不塌成点", () => {
    const bounds = normalizeBounds(
      [{ position: { x: 500, y: 500 } }],
      FALLBACK,
    );

    expect(bounds).toEqual({ minX: 500, maxX: 740, minY: 500, maxY: 580 });
  });

  it("尺寸可为带单位的字符串（React Flow 的 style 口径）", () => {
    const bounds = normalizeBounds(
      [{ position: { x: 0, y: 0 }, style: { width: "210", height: "90" } }],
      FALLBACK,
    );

    expect(bounds).toEqual({ minX: 0, maxX: 210, minY: 0, maxY: 90 });
  });

  it("没有节点 / 坐标非有限值 → null（由调用方走 fitView 兜底）", () => {
    expect(normalizeBounds([], FALLBACK)).toBeNull();
    expect(
      normalizeBounds(
        [{ position: { x: NaN, y: 0 }, style: { width: 10, height: 10 } }],
        FALLBACK,
      ),
    ).toBeNull();
  });
});

describe("computeFitViewport", () => {
  it("把包围盒中心放到容器中心，并留出边距", () => {
    const viewport = computeFitViewport(
      { minX: 600, maxX: 1670, minY: 2000, maxY: 2520 },
      CONTAINER,
    )!;

    const centerX = 600 + (1670 - 600) / 2;
    const centerY = 2000 + (2520 - 2000) / 2;
    // 视口变换：screen = world * zoom + offset
    expect(viewport.x + viewport.zoom * centerX).toBeCloseTo(
      CONTAINER.width / 2,
    );
    expect(viewport.y + viewport.zoom * centerY).toBeCloseTo(
      CONTAINER.height / 2,
    );
    // 内容完整落在容器内（含留白）
    expect(viewport.zoom * (1670 - 600)).toBeLessThanOrEqual(CONTAINER.width);
    expect(viewport.zoom * (2520 - 2000)).toBeLessThanOrEqual(CONTAINER.height);
  });

  it("首帧 measured 全 0 时聚焦到真实内容，而不是塌成一点", () => {
    const nodes = [
      unmeasured(1000, 2000, 210, 90),
      unmeasured(1400, 2400, 270, 120),
    ];
    const viewport = computeFitViewport(
      normalizeBounds(nodes, FALLBACK),
      CONTAINER,
    )!;

    // 内容中心 (1335, 2260) 必须落在容器中心，且是一个可读的缩放
    expect(viewport.x + viewport.zoom * 1335).toBeCloseTo(CONTAINER.width / 2);
    expect(viewport.y + viewport.zoom * 2260).toBeCloseTo(CONTAINER.height / 2);
    expect(viewport.zoom).toBeGreaterThanOrEqual(DEFAULT_MIN_FIT_ZOOM);
    expect(viewport.zoom).toBeLessThanOrEqual(DEFAULT_MAX_FIT_ZOOM);
  });

  it("小图不放到超过上限，宽图不缩到低于下限", () => {
    const tiny = computeFitViewport(
      { minX: 0, maxX: 100, minY: 0, maxY: 50 },
      CONTAINER,
    )!;
    expect(tiny.zoom).toBe(DEFAULT_MAX_FIT_ZOOM);

    const huge = computeFitViewport(
      { minX: 0, maxX: 9000, minY: 0, maxY: 6000 },
      CONTAINER,
    )!;
    expect(huge.zoom).toBe(DEFAULT_MIN_FIT_ZOOM);
  });

  it("容器尺寸为 0（未布局）时用兜底尺寸，不产生 Infinity / NaN", () => {
    const viewport = computeFitViewport(
      { minX: 0, maxX: 1000, minY: 0, maxY: 1000 },
      { width: 0, height: 0 },
    )!;

    expect(Number.isFinite(viewport.x)).toBe(true);
    expect(Number.isFinite(viewport.y)).toBe(true);
    expect(Number.isFinite(viewport.zoom)).toBe(true);
  });

  it("没有节点 → null", () => {
    expect(computeFitViewport(null, CONTAINER)).toBeNull();
  });
});

describe("createFitSettleStepper", () => {
  const OPTIONS = { fallbackSize: FALLBACK, settleRounds: 3, maxAttempts: 24 };

  it("节点分批测量时继续推进，直到范围不再扩大", () => {
    /* 第一帧只量到局部（上一个视图留下的视口），随后整图陆续量到。 */
    const frames: FitBoundsNode[][] = [
      [{ position: { x: 0, y: 0 }, measured: { width: 200, height: 100 } }],
      [
        { position: { x: 0, y: 0 }, measured: { width: 200, height: 100 } },
        { position: { x: 3000, y: 0 }, measured: { width: 200, height: 100 } },
      ],
    ];
    const stepper = createFitSettleStepper(OPTIONS);
    let index = 0;
    /* 未测量的节点在两帧里都带着声明尺寸，所以这里的「局部」完全来自测量的
     * 先后，而不是数据缺失 —— 与真实画布上的情形一致。 */
    const sample = () => frames[Math.min(index, frames.length - 1)]!;

    /* 首帧只量到局部：旧实现就是拿这个范围去 fit，视口于是停在内容之外。
     * 本实现的职责是把这次步进**继续下去**，直到范围稳定。 */
    const first = stepper.next(sample);
    expect(first.done).toBe(false);
    expect(first.bounds).toEqual({ minX: 0, maxX: 200, minY: 0, maxY: 100 });

    // 第二帧范围变大（0→3200），仍未收敛
    index = 1;
    const second = stepper.next(sample);
    expect(second.done).toBe(false);
    expect(second.bounds!.maxX).toBe(3200);

    // 不再扩大 → settleRounds 次之后收手
    expect(stepper.next(sample).done).toBe(false);
    expect(stepper.next(sample).done).toBe(false);
    expect(stepper.next(sample).done).toBe(true);
    expect(stepper.rounds()).toBe(5);
  });

  it("全部未测量时仍给出基于节点声明尺寸的范围（而不是放弃）", () => {
    const nodes = [
      unmeasured(1000, 2000, 210, 90),
      unmeasured(1400, 2400, 270, 120),
    ];
    const stepper = createFitSettleStepper(OPTIONS);

    const first = stepper.next(() => nodes);
    expect(first.bounds).toEqual({
      minX: 1000,
      maxX: 1670,
      minY: 2000,
      maxY: 2520,
    });
  });

  it("一直量不到任何节点时保留上一帧的范围，并在护栏内收手", () => {
    const stepper = createFitSettleStepper({ ...OPTIONS, maxAttempts: 4 });
    stepper.next(() => [
      { position: { x: 10, y: 10 }, style: { width: 100, height: 100 } },
    ]);

    let done = false;
    let rounds = 0;
    while (!done) {
      const result = stepper.next(() => []);
      expect(result.bounds).toEqual({
        minX: 10,
        maxX: 110,
        minY: 10,
        maxY: 110,
      });
      done = result.done;
      rounds += 1;
      expect(rounds).toBeLessThanOrEqual(10);
    }
    expect(stepper.rounds()).toBe(4);
  });

  it("始终量不到节点也保留 null 范围，交给调用方走 fitView 兜底", () => {
    const stepper = createFitSettleStepper({ ...OPTIONS, maxAttempts: 2 });

    expect(stepper.next(() => []).bounds).toBeNull();
    expect(stepper.next(() => []).done).toBe(true);
  });
});

describe("createFitOnceScheduler", () => {
  it("帧被取消后重排，不会把这次聚焦吃掉（同一 key 允许重复 markPending）", () => {
    /* 复现顺序：进入子图的那次 commit 里先排程（pending），紧接着 nodes 同步
     * effect 让聚焦 effect 重跑 —— cleanup 取消了 rAF，重跑必须能再排一次。
     * 旧实现把「已聚焦」在排程时就记死，重跑被拦住 ⇒ 视口停在上一份图。 */
    const scheduler = createFitOnceScheduler();

    expect(scheduler.markPending("4#subgraph:uid")).toBe(true);
    /* cleanup 取消了未触发的 rAF：这次 markPending 是重排，必须仍然放行。 */
    expect(scheduler.markPending("4#subgraph:uid")).toBe(true);
    expect(scheduler.isSettled("4#subgraph:uid")).toBe(false);

    /* 真正下发视口后才算已聚焦；此后再排程应被拒绝（用户手动拖动后不抢视角）。 */
    scheduler.markSettled("4#subgraph:uid");
    expect(scheduler.isSettled("4#subgraph:uid")).toBe(true);
    expect(scheduler.markPending("4#subgraph:uid")).toBe(false);
  });

  it("切换图（key 不同）时重新排程，两张图各聚焦一次", () => {
    const scheduler = createFitOnceScheduler();
    scheduler.markPending("__root__");
    scheduler.markSettled("__root__");

    expect(scheduler.markPending("4#subgraph:uid")).toBe(true);
    expect(scheduler.isSettled("__root__")).toBe(true);
    expect(scheduler.isSettled("4#subgraph:uid")).toBe(false);
  });
});
