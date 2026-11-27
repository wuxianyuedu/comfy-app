/**
 * 分镜质量口径与镜头级审批（ISSUE #5216）：三条只读检查、引用可达、
 * 审批过滤与草图预设的纯函数契约。
 */
import { describe, expect, it } from "vitest";

import {
  approvableShotIds,
  characterIdsOf,
  checkStoryboardQuality,
  previewSizeOf,
} from "./storyboard-quality";

describe("characterIdsOf", () => {
  it("只收非空 id，脏形状当没有角色", () => {
    expect(characterIdsOf([{ id: "c1" }, { id: "" }, null, 42])).toEqual(["c1"]);
    expect(characterIdsOf("c1")).toEqual([]);
  });
});

describe("checkStoryboardQuality", () => {
  const shots = [
    { characterIds: ["c1"], description: "雨夜街头", duration: 3, prompt: "霓虹倒影，电影感" },
    { characterIds: [], description: "清晨码头", duration: 4, prompt: "薄雾中的码头" },
  ];

  it("三条口径都满足时 0 问题", () => {
    expect(
      checkStoryboardQuality({ characterIds: ["c1", "c2"], shots, targetDurationSec: 7 }),
    ).toEqual([]);
  });

  it("角色指向不到 / 提示词与描述相同 / 总时长为 0 都点名", () => {
    const issues = checkStoryboardQuality({
      characterIds: [],
      shots: [{ characterIds: ["ghost"], description: "同一句", duration: 0, prompt: "同一句" }],
    });
    const text = issues.map((i) => i.message).join(" ");
    expect(text).toContain("不存在的角色 ghost");
    expect(text).toContain("提示词与画面描述相同");
    expect(text).toContain("时长之和为 0");
    expect(issues[0]?.index).toBe(1);
  });

  it("总时长与目标差一个量级时给出同量级提示", () => {
    const issues = checkStoryboardQuality({
      characterIds: [],
      shots: [{ duration: 300, prompt: "x" }],
      targetDurationSec: 7,
    });
    expect(issues.map((i) => i.message).join(" ")).toContain("不在同一量级");
  });
});

describe("approvableShotIds", () => {
  it("显式 false 才挡下，历史镜头缺省视为已批准", () => {
    expect(
      approvableShotIds([{ approved: false, id: "a" }, { id: "b" }, { approved: true, id: "c" }]),
    ).toEqual({ blocked: ["a"], ids: ["b", "c"] });
  });
});

describe("previewSizeOf", () => {
  it("保留比例压到草图档，外来尺寸不抛", () => {
    expect(previewSizeOf({ size: { ratio: "16:9", clarity: "2k", multiple: 64 } })).toEqual({
      clarity: "0.25M",
      multiple: 64,
      ratio: "16:9 横屏",
    });
    expect(previewSizeOf(null).clarity).toBe("0.25M");
  });
});
