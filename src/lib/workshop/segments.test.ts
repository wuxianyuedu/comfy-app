/**
 * 生成选段与逐镜连续性（ISSUE #5299）：外来选段收窄、合成选段与连续性只读检查的纯函数契约。
 */
import { describe, expect, it } from "vitest";

import { continuityIssues, normalizeSegments, selectedSegment } from "./segments";

describe("normalizeSegments", () => {
  it("只收 start>=0 且 end>start 的选段，脏项跳过", () => {
    expect(
      normalizeSegments([
        { end: 4, purpose: "挂断", start: 2 },
        { end: 1, start: 3 },
        { end: "x", start: 0 },
        null,
      ]),
    ).toEqual([{ end: 4, purpose: "挂断", start: 2 }]);
    expect(normalizeSegments("x")).toEqual([]);
  });
});

describe("selectedSegment", () => {
  it("取第一段，无选段回落整段", () => {
    const segments = normalizeSegments([
      { end: 2, purpose: "开场", start: 0 },
      { end: 5, purpose: "挂断", start: 3 },
    ]);
    expect(selectedSegment(segments)?.purpose).toBe("开场");
    expect(selectedSegment([])).toBeNull();
  });
});

describe("continuityIssues", () => {
  it("角色/场景引用可达时不点名；无台词给温和提示", () => {
    expect(
      continuityIssues({
        characters: [{ id: "c1" }],
        scenes: [{ id: "s1" }],
        shots: [{ characterIds: ["c1"], dialogue: "你好", sceneId: "s1" }],
      }),
    ).toEqual([]);
  });

  it("引用不到/全无台词/缺数据都给可读提示，不抛", () => {
    const issues = continuityIssues({
      characters: undefined,
      scenes: [],
      shots: [{ characterIds: ["ghost"], dialogue: "", sceneId: "missing" }],
    });
    expect(issues.join(" ")).toContain("不存在的角色 ghost");
    expect(issues.join(" ")).toContain("不存在的场景 missing");
    expect(issues.join(" ")).toContain("没有台词");
    expect(issues.join(" ")).toContain("请人工核对");
  });
});
