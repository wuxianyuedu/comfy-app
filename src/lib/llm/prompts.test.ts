import { describe, expect, it } from "vitest";
import {
  buildCharacterFromBriefMessages,
  buildCharacterMessages,
  buildScriptMarkdownMessages,
  buildScriptTemplate,
  buildStoryboardMessages,
  parseCharacter,
  parseCharacterFull,
  parseStoryboard,
} from "./prompts";

/* prompts.ts 是「模型输出 → 结构化数据」的唯一边界，两个地方最容易出事：
 *   ① 模型不听话（带代码围栏、带前言、字段名写错、给了越界景别）
 *   ② 值不是字符串（对象 / 数组 / null）—— 直接拼进模板会得到 `[object Object]`
 * 所以用例全部走「不听话的模型」这条线。 */

describe("buildScriptMarkdownMessages", () => {
  it("项目类型 / 基调 / 梗概 / 灵感都进 user 消息，system 是剧本规范", () => {
    const [system, user] = buildScriptMarkdownMessages(
      { type: "micro_film", tone: "悬疑", logline: "一句话梗概" },
      "一段灵感",
    );
    expect(system!.role).toBe("system");
    expect(system!.content).toContain("剧本 Markdown");
    expect(user!.content).toContain("悬疑");
    expect(user!.content).toContain("一句话梗概");
    expect(user!.content).toContain("一段灵感");
  });

  it("基调与梗概留空时用可读占位，不留下空行或 undefined", () => {
    const [, user] = buildScriptMarkdownMessages(
      { type: "micro_film", tone: "", logline: "" },
      "idea",
    );
    expect(user!.content).not.toContain("undefined");
    expect(user!.content).toContain("未指定");
    expect(user!.content).toContain("无");
  });
});

describe("buildScriptTemplate", () => {
  it("离线模板带场景骨架与台词占位（不调用模型）", () => {
    const md = buildScriptTemplate(
      { type: "micro_film", tone: "温暖", logline: "梗概" },
      "我的灵感",
    );
    expect(md).toContain("## 场景1");
    expect(md).toContain("V1 角色名");
    expect(md).toContain("我的灵感");
    expect(md).toContain("温暖");
  });

  it("段落之间不留连续空行，也不以空行结尾", () => {
    const md = buildScriptTemplate(
      { type: "micro_film", tone: "", logline: "" },
      "x",
    );
    expect(md).not.toMatch(/\n{3,}/);
    expect(md).toBe(md.trim());
  });

  it("未知项目类型回落到原值，不产出 undefined", () => {
    const md = buildScriptTemplate(
      // 故意塞一个 PROJECT_TYPE_LABELS 覆盖不到的取值。
      { type: "unknown-type" as never, tone: "", logline: "" },
      "x",
    );
    expect(md).toContain("unknown-type");
    expect(md).not.toContain("undefined");
  });
});

describe("buildCharacterMessages", () => {
  it("只带已有信息，空字段不占位", () => {
    const [, user] = buildCharacterMessages({
      name: "阿离",
      appearance: "短发",
    });
    expect(user!.content).toContain("阿离");
    expect(user!.content).toContain("短发");
    expect(user!.content).not.toContain("服装");
  });

  it("信息全空时给出兜底指令，而不是发一条空消息", () => {
    const [, user] = buildCharacterMessages({ name: "" });
    expect(user!.content.trim()).toBe("请帮我设计一个原创角色");
  });

  it("风格标签用顿号连接", () => {
    const [, user] = buildCharacterMessages({
      name: "x",
      styleTags: ["a", "b"],
    });
    expect(user!.content).toContain("a、b");
  });
});

describe("parseCharacter", () => {
  it("从带围栏与前后文的输出里取出三个字段", () => {
    const got = parseCharacter(
      '好的，这是结果：\n```json\n{"appearance":"高个子","costume":"风衣","personality":"冷静"}\n```\n希望有帮助',
    );
    expect(got).toEqual({
      appearance: "高个子",
      costume: "风衣",
      personality: "冷静",
    });
  });

  it("缺字段补空串，不产出 undefined", () => {
    expect(parseCharacter('{"appearance":"只有外貌"}')).toEqual({
      appearance: "只有外貌",
      costume: "",
      personality: "",
    });
  });

  it("字段值是对象 / 数组时序列化为 JSON 文本，不产出 [object Object]", () => {
    const got = parseCharacter(
      '{"appearance":{"hair":"黑色"},"costume":["风衣","靴子"],"personality":null}',
    );
    expect(got.appearance).toBe('{"hair":"黑色"}');
    expect(got.costume).toBe('["风衣","靴子"]');
    expect(got.personality).toBe("");
    expect(JSON.stringify(got)).not.toContain("[object Object]");
  });

  it("输出完全不是 JSON 时抛错（调用方据此走失败分支）", () => {
    expect(() => parseCharacter("模型今天不想说话")).toThrow();
  });
});

describe("parseCharacterFull", () => {
  it("角色名为空时用「未命名角色」兜底", () => {
    const got = parseCharacterFull(
      '{"appearance":"a","costume":"b","personality":"c"}',
    );
    expect(got.name).toBe("未命名角色");
  });

  it("带名字时原样保留", () => {
    expect(parseCharacterFull('{"name":"阿离"}').name).toBe("阿离");
  });

  it("名字给了非字符串也归一成字符串", () => {
    expect(parseCharacterFull('{"name":123}').name).toBe("123");
  });
});

describe("buildStoryboardMessages", () => {
  it("场景信息与角色名单进 user 消息", () => {
    const [, user] = buildStoryboardMessages(
      {
        heading: "场景1",
        location: "天台",
        time: "夜",
        action: "奔跑",
        dialogue: "快跑",
      },
      ["阿离", "老张"],
      "写实",
    );
    expect(user!.content).toContain("天台");
    expect(user!.content).toContain("阿离、老张");
    expect(user!.content).toContain("写实");
  });

  it("无角色 / 无风格时给出可读占位", () => {
    const [, user] = buildStoryboardMessages(
      { heading: "h", location: "l", time: "t", action: "a", dialogue: "d" },
      [],
    );
    expect(user!.content).toContain("（无）");
    expect(user!.content).toContain("默认");
    expect(user!.content).not.toContain("undefined");
  });
});

describe("parseStoryboard", () => {
  it("合法景别原样保留", () => {
    const got = parseStoryboard(
      '[{"shotType":"close","description":"特写","characterNames":["阿离"]}]',
    );
    expect(got).toEqual([
      { shotType: "close", description: "特写", characterNames: ["阿离"] },
    ]);
  });

  it("越界景别回落到 medium（不把非法值透给下游）", () => {
    const got = parseStoryboard('[{"shotType":"god_view","description":"d"}]');
    expect(got[0]!.shotType).toBe("medium");
  });

  it("characterNames 不是数组时归一为空数组", () => {
    expect(
      parseStoryboard('[{"shotType":"wide","characterNames":"阿离"}]')[0]!
        .characterNames,
    ).toEqual([]);
  });

  it("characterNames 元素统一转字符串（下游按名字匹配角色卡）", () => {
    const got = parseStoryboard(
      '[{"shotType":"wide","characterNames":[1,{"n":"x"},null]}]',
    );
    expect(got[0]!.characterNames).toEqual(["1", "[object Object]", "null"]);
  });

  it("数组元素是 null / 非对象时不崩，产出可读兜底", () => {
    const got = parseStoryboard('[null,{"description":"d"}]');
    expect(got).toHaveLength(2);
    expect(got[0]!.shotType).toBe("medium");
    expect(got[0]!.description).toBe("");
  });

  it("输出不是数组时抛错", () => {
    expect(() => parseStoryboard('{"shotType":"wide"}')).toThrow(/数组/);
  });

  it("空数组合法（模型判断该场景没镜头）", () => {
    expect(parseStoryboard("[]")).toEqual([]);
  });
});

describe("buildCharacterFromBriefMessages", () => {
  it("brief 原样进 user 消息", () => {
    const [, user] = buildCharacterFromBriefMessages("一个夜班出租车司机");
    expect(user!.content).toBe("一个夜班出租车司机");
  });
});
