/**
 * 角色特征标签提取用例（ISSUE #5009）：发色 / 瞳色的生成式匹配、
 * 各维度字面词表、去重封顶与幂等。
 */
import { describe, expect, it } from "vitest";

import { CHARACTER_TAG_CAP, extractCharacterTags } from "./tag-extract";

describe("extractCharacterTags —— 发色 / 瞳色（生成式）", () => {
  it("「银白色的长发」提出 银发 + 长发", () => {
    expect(extractCharacterTags("她有一头银白色的长发，气质清冷。")).toContain("银发");
    expect(extractCharacterTags("她有一头银白色的长发，气质清冷。")).toContain("长发");
  });

  it("「金色的瞳孔」提出 金瞳；「红色的眼睛」提出 红瞳", () => {
    expect(extractCharacterTags("金色的瞳孔在暗处发亮")).toContain("金瞳");
    expect(extractCharacterTags("一双红色的眼睛")).toContain("红瞳");
  });

  it("「红发」「黑色短发」等简写也能命中", () => {
    expect(extractCharacterTags("红发少女")).toContain("红发");
    expect(extractCharacterTags("黑色短发的少年")).toContain("黑发");
    expect(extractCharacterTags("黑色短发的少年")).toContain("短发");
  });
});

describe("extractCharacterTags —— 字面词表维度", () => {
  it("种族 / 服饰 / 性格 / 原型 / 题材各提一枚", () => {
    const tags = extractCharacterTags(
      "头顶猫耳，身穿女仆装，性格傲娇，是一名魔法少女，活跃在校园题材。",
    );
    expect(tags).toContain("猫耳");
    expect(tags).toContain("女仆装");
    expect(tags).toContain("傲娇");
    expect(tags).toContain("魔法少女");
    expect(tags).toContain("校园");
  });

  it("extra 上下文参与匹配：原型名直接成为标签", () => {
    expect(extractCharacterTags("她挥舞着法杖。", "机甲驾驶员")).toContain("机甲驾驶员");
  });
});

describe("extractCharacterTags —— 稳定性", () => {
  it("去重且顺序稳定（同一份描述反复提取结果一致）", () => {
    const text = "银发红瞳，银发红瞳，穿水手服。";
    const first = extractCharacterTags(text);
    const second = extractCharacterTags(text);
    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(first.length);
  });

  it("封顶：标签数不超过 CHARACTER_TAG_CAP", () => {
    const everything = [
      "银白色的长发梳成双马尾，金色的瞳孔，猫耳狐耳兔耳龙角恶魔角天使翼精灵耳机械臂义眼，",
      "穿水手服和服女仆装哥特萝莉旗袍汉服军装礼服，戴眼镜墨镜面具贝雷帽围巾项圈耳机，",
      "性格傲娇天然呆三无病娇高冷元气温柔腹黑，是魔法少女剑士弓箭手魔法师忍者武士骑士，",
      "校园奇幻科幻赛博朋克蒸汽朋克和风古风末日异世界魔法学院星际武侠仙侠。",
    ].join("");
    const tags = extractCharacterTags(everything);
    expect(tags.length).toBe(CHARACTER_TAG_CAP);
  });

  it("空描述返回空数组，不编造标签", () => {
    expect(extractCharacterTags("")).toEqual([]);
    expect(extractCharacterTags(" nothing matches here ")).toEqual([]);
  });
});
