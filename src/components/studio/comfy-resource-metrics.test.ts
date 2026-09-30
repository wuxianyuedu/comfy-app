// 资源指标描述符：状态栏与首页算力卡共用那一份口径。
//
// 这个模块存在的理由是「同一件事只命名一次」，用例就钉这件事：
//   · 两条显存口径必须**分开命名**（物理 vs CUDA 逻辑），被合并成一根「显存」就是撒谎；
//   · 渲染次序固定（物理 → ComfyUI → 内存），两处消费点不该出现两种顺序；
//   · 缺读数的档整档隐藏 —— 画成 0% 会把「读不到」说成「没用」，是另一种错法。
import { describe, expect, it } from "vitest";

import {
  RESOURCE_METRICS,
  STALE_RESOURCE_NOTE,
  WAIT_FIRST_SAMPLE_NOTE,
  selectVisibleResourceMetrics,
} from "./comfy-resource-metrics";
import type { ComfyStatusViewModel } from "./hooks/use-comfy-readiness";

const GIB = 1024 * 1024 * 1024;

function bar(usedGiB: number, totalGiB: number, pct: number) {
  return { used: usedGiB * GIB, total: totalGiB * GIB, pct };
}

/** 只给选择器需要的三档，其余字段与本题无关。 */
function view(
  over: Partial<
    Pick<ComfyStatusViewModel, "smiVram" | "cudaVram" | "ram">
  > = {},
): Pick<ComfyStatusViewModel, "smiVram" | "cudaVram" | "ram"> {
  return { smiVram: null, cudaVram: null, ram: null, ...over };
}

describe("RESOURCE_METRICS 口径命名", () => {
  it("次序固定为 物理显存 → ComfyUI 显存 → 内存", () => {
    expect(RESOURCE_METRICS.map((m) => m.key)).toEqual([
      "smiVram",
      "cudaVram",
      "ram",
    ]);
  });

  it("两条显存口径各自有名、且都在 title 里点名口径来源", () => {
    const byKey = new Map(RESOURCE_METRICS.map((m) => [m.key, m]));
    expect(byKey.get("smiVram")?.label).toBe("显存");
    expect(byKey.get("cudaVram")?.label).toBe("显存·ComfyUI");
    expect(byKey.get("smiVram")?.label).not.toBe(byKey.get("cudaVram")?.label);
    expect(byKey.get("smiVram")?.title).toBe(
      "nvidia-smi 物理专用显存（与任务管理器「专用 GPU 内存」同口径）",
    );
    expect(byKey.get("cudaVram")?.title).toBe(
      "ComfyUI 上报的 CUDA 口径（显存剩余可用/总量，已用 = 总量 − 剩用）",
    );
  });

  it("每一档的 key 都能取到读数槽，标签非空", () => {
    for (const metric of RESOURCE_METRICS) {
      expect(metric.label.trim().length).toBeGreaterThan(0);
      expect(metric.title.trim().length).toBeGreaterThan(0);
      expect(view()[metric.key]).toBeNull();
    }
  });
});

describe("selectVisibleResourceMetrics", () => {
  it("三档都有读数时按固定次序全部返回", () => {
    const out = selectVisibleResourceMetrics(
      view({
        ram: bar(16, 32, 50),
        cudaVram: bar(2, 8, 25),
        smiVram: bar(3, 12, 25),
      }),
    );
    expect(out.map((m) => m.descriptor.key)).toEqual([
      "smiVram",
      "cudaVram",
      "ram",
    ]);
    expect(out[0]?.bar.used).toBe(3 * GIB);
  });

  it("缺读数的档整档隐藏，不返回占位项", () => {
    const out = selectVisibleResourceMetrics(view({ cudaVram: bar(2, 8, 25) }));
    expect(out.map((m) => m.descriptor.key)).toEqual(["cudaVram"]);
  });

  it("全空时返回空数组（消费点据此决定「一根条都不画」）", () => {
    expect(selectVisibleResourceMetrics(view())).toEqual([]);
  });

  it("0% 是真读数，不能被当成「没数据」丢掉", () => {
    const out = selectVisibleResourceMetrics(view({ ram: bar(0, 32, 0) }));
    expect(out.map((m) => m.descriptor.key)).toEqual(["ram"]);
    expect(out[0]?.bar.pct).toBe(0);
  });
});

describe("共享文案常量", () => {
  it("陈旧与首帧未到是两句话，不许复用同一条", () => {
    expect(STALE_RESOURCE_NOTE).not.toBe(WAIT_FIRST_SAMPLE_NOTE);
    expect(STALE_RESOURCE_NOTE).toContain("上一次数据");
    expect(WAIT_FIRST_SAMPLE_NOTE).toContain("首帧");
  });
});
