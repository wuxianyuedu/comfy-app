// 屏顶健康度快照的判据。
//
// 锁两件事：完成度只能来自 stageRatios（不掺任何写死目标），以及「还差几段」的
// 计数与逐段 pending 判定必须一致 —— 屏顶同时有总进度条、胶囊、导航小字三种表述，
// 最容易出的错是同一状态在两处给出不同结论。
import { describe, expect, it } from "vitest";

import {
  buildHealthSnapshot,
  computeStageRatios,
  countPendingStages,
  STAGE_DEFS,
  type StageViewContext,
} from "./stage-config";

function ctx(over: Partial<StageViewContext> = {}): StageViewContext {
  return {
    scriptReady: false,
    characterCount: 0,
    sceneCount: 0,
    shotCount: 0,
    shotTarget: 0,
    imageDoneCount: 0,
    clipDoneCount: 0,
    ...over,
  };
}

describe("buildHealthSnapshot", () => {
  it("全空草稿：六段都没完成，计数等于段数", () => {
    const empty = ctx();
    const rows = buildHealthSnapshot(computeStageRatios(empty, false), empty);
    expect(rows).toHaveLength(STAGE_DEFS.length);
    expect(rows.every((row) => row.pending)).toBe(true);
    expect(countPendingStages(rows)).toBe(STAGE_DEFS.length);
  });

  it("剧本导出即完成：该段 pending 转 false，计数随之减一", () => {
    const ready = ctx({ scriptReady: true });
    const rows = buildHealthSnapshot(computeStageRatios(ready, false), ready);
    const script = rows.find((row) => row.id === "script");
    expect(script?.pending).toBe(false);
    expect(countPendingStages(rows)).toBe(STAGE_DEFS.length - 1);
  });

  it("成片只在 rendered 为真时算完成，其余段不受它影响", () => {
    const base = ctx({ scriptReady: true });
    const notRendered = buildHealthSnapshot(
      computeStageRatios(base, false),
      base,
    );
    const rendered = buildHealthSnapshot(computeStageRatios(base, true), base);
    expect(notRendered.find((row) => row.id === "render")?.pending).toBe(true);
    expect(rendered.find((row) => row.id === "render")?.pending).toBe(false);
    expect(countPendingStages(rendered)).toBe(
      countPendingStages(notRendered) - 1,
    );
  });
});
