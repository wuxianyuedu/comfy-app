/**
 * 机位覆盖判据（ISSUE #5297）：机位提示词、覆盖镜识别与「先基础动作后覆盖」顺序的纯函数契约。
 */
import { describe, expect, it } from "vitest";

import {
  COVERAGE_PRESETS,
  coverageOrderIssues,
  coveragePromptSuffix,
  coverageTargets,
} from "./coverage";

describe("coveragePromptSuffix", () => {
  it("三种预设给各自机位约束，并保留动作方向/站位/服装", () => {
    expect([...COVERAGE_PRESETS]).toEqual(["foreground", "low", "wide"]);
    expect(coveragePromptSuffix("wide")).toContain("wider shot");
    expect(coveragePromptSuffix("low")).toContain("low angle");
    expect(coveragePromptSuffix("foreground")).toContain("foreground occluder");
    for (const preset of COVERAGE_PRESETS) {
      const suffix = coveragePromptSuffix(preset);
      expect(suffix).toContain("preserve exact positions");
      expect(suffix).toContain("action direction");
      expect(suffix).toContain("wardrobe");
    }
  });

  it("脏预设回落 wide，不把任何外来值原样塞进提示词", () => {
    expect(coveragePromptSuffix("evil")).toBe(coveragePromptSuffix("wide"));
    expect(coveragePromptSuffix(undefined)).toBe(coveragePromptSuffix("wide"));
  });
});

describe("coverageTargets", () => {
  it("只收有覆盖来源的镜头", () => {
    expect(
      coverageTargets([
        { coverageFromShotId: "s1", id: "s2", index: 2 },
        { id: "s1", index: 1 },
        { coverageFromShotId: "", id: "s3", index: 3 },
      ]).map((shot) => shot.id),
    ).toEqual(["s2"]);
  });
});

describe("coverageOrderIssues", () => {
  const shots = [
    { id: "s1", index: 0 },
    { coverageFromShotId: "s1", id: "s2", index: 1 },
  ];

  it("基础动作在前 → 0 问题", () => {
    expect(coverageOrderIssues(shots)).toEqual([]);
  });

  it("来源不在表内 / 排在基础镜之前都点名，但不阻断", () => {
    expect(
      coverageOrderIssues([
        { coverageFromShotId: "s2", id: "s1", index: 0 },
        { id: "s2", index: 1 },
      ]).join(" "),
    ).toContain("请先生成基础动作");
    expect(
      coverageOrderIssues([{ coverageFromShotId: "missing", id: "s1", index: 0 }]).join(" "),
    ).toContain("不在本片镜头表里");
  });
});
