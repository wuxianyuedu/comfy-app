/**
 * 生成选段与逐镜连续性（ISSUE #5299）：外来选段收窄、合成选段与连续性只读检查的纯函数契约。
 */
import { describe, expect, it } from "vitest";

import {
  anchorIssues,
  continuityIssues,
  normalizeAnchors,
  normalizeSegments,
  selectedSegment,
} from "./segments";

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

describe("normalizeAnchors", () => {
  it("只收五锚中的非空字符串，脏值/空串跳过", () => {
    expect(
      normalizeAnchors({
        ambience: "雨声",
        geography: "",
        light: 42,
        timeOfDay: "黄昏",
        wardrobe: "红外套",
        unknown: "x",
      }),
    ).toEqual({ ambience: "雨声", timeOfDay: "黄昏", wardrobe: "红外套" });
    expect(normalizeAnchors("x")).toEqual({});
  });
});

describe("anchorIssues", () => {
  it("全没填不发声", () => {
    expect(anchorIssues([{}, {}, {}])).toEqual([]);
  });

  it("相邻镜同一锚都填却不同 → 可行动提示", () => {
    const issues = anchorIssues([{ light: "暖光左打" }, { light: "冷光右打" }]);
    expect(issues.join(" ")).toContain("光照锚不一致");
    expect(issues.join(" ")).toContain("逐字复制");
  });

  it("只填一镜 → 温和提示；都相同则无提示", () => {
    const partial = anchorIssues([{ wardrobe: "红外套" }, {}]);
    expect(partial.join(" ")).toContain("只在其中一镜填写");
    expect(anchorIssues([{ wardrobe: "红外套" }, { wardrobe: "红外套" }])).toEqual([]);
  });
});
