// 项目主页状态派生的纯函数契约：阶段完成判据、计数、进度与「下一步」。
import { describe, expect, it } from "vitest";

import { DEFAULT_PRODUCTION_PROGRESS } from "./progress";
import {
  deriveProjectOverview,
  overviewHeadline,
  STAGE_LABEL,
  type ProjectOverview,
} from "./project-home";
import type { ProductionRunView } from "./run-types";

function view(over: Partial<ProductionRunView> = {}): ProductionRunView {
  return {
    characterCount: 0,
    filmRendered: false,
    hasScript: false,
    scriptDigest: "",
    shots: [],
    ...over,
  };
}

/** 造 n 个镜头，前 imageDone 个有图、前 clipDone 个有片段。 */
function shots(n: number, imageDone = 0, clipDone = 0): ProductionRunView["shots"] {
  return Array.from({ length: n }, (_, index) => ({
    hasClip: index < clipDone,
    hasImage: index < imageDone,
    id: `s${index + 1}`,
    rev: 0,
  }));
}

function overview(over: Partial<ProductionRunView> = {}): ProjectOverview {
  return deriveProjectOverview(view(over), DEFAULT_PRODUCTION_PROGRESS);
}

describe("deriveProjectOverview", () => {
  it("空项目：六个阶段全未完成、进度 0、下一步是剧本", () => {
    const o = overview();
    expect(o.totalCount).toBe(6);
    expect(o.doneCount).toBe(0);
    expect(o.progressPct).toBe(0);
    expect(o.nextStage).toBe("script");
    expect(o.stages.map((row) => row.id)).toEqual([
      "script",
      "character",
      "storyboard",
      "shots",
      "video",
      "render",
    ]);
  });

  it("有剧本 → 只算剧本这一阶段完成", () => {
    const o = overview({ hasScript: true });
    expect(o.doneCount).toBe(1);
    expect(o.nextStage).toBe("character");
    expect(o.stages.find((row) => row.id === "script")?.done).toBe(true);
  });

  it("有角色 → 角色阶段完成，计数带单位", () => {
    const o = overview({ characterCount: 3, hasScript: true });
    expect(o.characterCount).toBe(3);
    expect(o.stages.find((row) => row.id === "character")).toMatchObject({
      detail: "3 个",
      done: true,
    });
  });

  it("零镜头时「镜头生图 / 视频生成」不算完成，也不报 0/0", () => {
    const o = overview({ characterCount: 1, hasScript: true });
    expect(o.stages.find((row) => row.id === "shots")).toMatchObject({
      detail: "",
      done: false,
    });
    expect(o.stages.find((row) => row.id === "video")).toMatchObject({
      detail: "",
      done: false,
    });
  });

  it("图未齐 → 镜头生图未完成；齐了才完成（计数口径为「已出图 / 总数」）", () => {
    const partial = overview({
      characterCount: 1,
      hasScript: true,
      shots: shots(4, 3),
    });
    expect(partial.imageDoneCount).toBe(3);
    expect(partial.shotCount).toBe(4);
    expect(partial.stages.find((row) => row.id === "shots")).toMatchObject({
      detail: "3/4 镜",
      done: false,
    });
    expect(partial.nextStage).toBe("shots");

    const full = overview({
      characterCount: 1,
      hasScript: true,
      shots: shots(4, 4),
    });
    expect(full.stages.find((row) => row.id === "shots")?.done).toBe(true);
    expect(full.nextStage).toBe("video");
  });

  it("片段齐 + 已出片 → 全部完成", () => {
    const o = deriveProjectOverview(
      view({
        characterCount: 2,
        filmRendered: true,
        hasScript: true,
        shots: shots(3, 3, 3),
      }),
      { rendered: true, stage: "render" },
    );
    expect(o.doneCount).toBe(6);
    expect(o.progressPct).toBe(100);
    expect(o.nextStage).toBeNull();
    expect(overviewHeadline(o)).toBe("全流程已完成");
  });

  it("游标落在已完成阶段时不让它抢「当前」（全部完成时不会出现两个状态）", () => {
    const o = deriveProjectOverview(view({ hasScript: true }), {
      rendered: false,
      stage: "script",
    });
    expect(o.stages.find((row) => row.id === "script")).toMatchObject({
      current: false,
      done: true,
    });
  });

  it("游标落在未完成阶段上 → 该阶段即「当前」", () => {
    const o = deriveProjectOverview(view({ hasScript: true }), {
      rendered: false,
      stage: "storyboard",
    });
    expect(o.stages.find((row) => row.id === "storyboard")?.current).toBe(true);
  });

  it("阶段名与工坊同一套词（每个阶段都有中文名）", () => {
    for (const label of Object.values(STAGE_LABEL)) {
      expect(label.length).toBeGreaterThan(0);
    }
    expect(STAGE_LABEL.shots).toBe("镜头生图");
  });
});

describe("overviewHeadline", () => {
  it("未完成时报「下一步：X」", () => {
    expect(overviewHeadline(overview({ hasScript: true }))).toBe("下一步：角色卡");
  });

  it("空项目报「下一步：剧本」（阶段表是常量，不需要「还没有开始」这条分支）", () => {
    expect(overviewHeadline(overview())).toBe("下一步：剧本");
  });
});
