import { describe, it, expect } from "vitest";
import {
  matchSceneHeading,
  parseCharacterEntries,
  parseShotDrafts,
  draftToShotEntry,
  parseExtractedCharacters,
  parseExtractedShots,
  parseImportedCharacterCards,
  mergeCharacterDrafts,
  matchSceneByHeading,
  buildShotsFromEntries,
  buildExtractCharactersMessages,
  buildExtractShotsMessages,
} from "./script-parse";
import type { Character, Scene, StyleRef } from "./types";

/* ── 测试夹具 ─────────────────────────────────────────────── */

const SCRIPT = `# 未命名剧本

## 故事大纲
小满在天台遇到会说话的收音机。

人物:小满(女,25岁)——短黑发,清秀,白色连衣裙
角色:阿声(复古收音机) 磨损的旋钮,沙哑嗓音
人物:老陈、路人甲

1-1 场景 外 旧城区天台(黄昏)
Δ小满爬上天台,风吹起她的裙摆。
V1 小满:你是谁?为什么会说话?
Δ她发现角落里一台旧收音机。
V2 阿声:我播放未来的声音。

1-2 场景 内 出租屋(夜晚)
V3 小满:今天的事太奇怪了。
Δ小满把收音机放上书桌。

场景3 · 天台对峙
Δ小满质问阿声的来历。
`;

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: "char_1",
    name: "小满",
    ageGender: "",
    appearance: "",
    costume: "",
    personality: "",
    temperament: "",
    styleTags: [],
    positivePrompt: "",
    negativePrompt: "",
    params: {},
    ...overrides,
  };
}

function makeScene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: "scene_1",
    heading: "1-1 场景 外 旧城区天台(黄昏)",
    location: "",
    time: "",
    action: "",
    dialogue: "",
    shotCount: 2,
    ...overrides,
  };
}

const STYLES: StyleRef[] = [
  {
    slug: "pixar",
    name: "皮克斯",
    icon: "🎬",
    promptTemplate: "pixar style, 3d render",
    negativePrompt: "realistic photo",
    defaultParams: { steps: 30, cfg: 6.5 },
  },
];

/* ── parseCharacterEntries 角色行解析 ─────────────────────── */

describe("parseCharacterEntries 从剧本提取角色卡", () => {
  it("解析「人物:/角色:」行的括号年龄与外貌描述", () => {
    const drafts = parseCharacterEntries(SCRIPT);
    const xm = drafts.find((d) => d.name === "小满");
    expect(xm).toBeDefined();
    expect(xm?.ageGender).toBe("女,25岁");
    expect(xm?.appearance).toContain("短黑发");
    const as = drafts.find((d) => d.name === "阿声");
    expect(as?.ageGender).toBe("复古收音机");
    expect(as?.appearance).toContain("磨损的旋钮");
  });

  it("顿号分隔的多人行拆成多个角色", () => {
    const drafts = parseCharacterEntries(SCRIPT);
    expect(drafts.some((d) => d.name === "老陈")).toBe(true);
    expect(drafts.some((d) => d.name === "路人甲")).toBe(true);
  });

  it("空剧本与无结构文本返回空数组", () => {
    expect(parseCharacterEntries("")).toEqual([]);
    expect(parseCharacterEntries("这是一段没有任何结构标记的普通叙述文字。\n第二行也只是叙述。")).toEqual([]);
  });

  it("同名角色去重,后条仅在前条外貌为空时补齐", () => {
    const drafts = parseCharacterEntries(
      "人物:小满\n角色:小满——红色风衣,牛仔裤"
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.appearance).toBe("红色风衣,牛仔裤");
  });

  it("忽略非人物行(如「主要情节:」)", () => {
    const drafts = parseCharacterEntries("主要情节:小满冒险\n结局:圆满");
    expect(drafts).toEqual([]);
  });
});

/* ── matchSceneHeading 场景标题识别 ───────────────────────── */

describe("matchSceneHeading 场景标题行识别", () => {
  it("识别「1-1 场景 外 地点(时间)」并列出标记与尾段", () => {
    const info = matchSceneHeading("1-1 场景 外 旧城区天台(黄昏)");
    expect(info).not.toBeNull();
    expect(info?.marker).toBe("外");
    expect(info?.tail).toContain("旧城区天台");
  });

  it("识别「场景2 · 标题」与「第3场 标题」", () => {
    expect(matchSceneHeading("场景2 · 天台对峙")).not.toBeNull();
    expect(matchSceneHeading("## 第3场 天台对峙")).not.toBeNull();
  });

  it("普通文本行不误判为场景标题", () => {
    expect(matchSceneHeading("场面混乱,人群四散")).toBeNull();
    expect(matchSceneHeading("12-30 两人对视良久")).toBeNull();
    expect(matchSceneHeading("他说:我们走吧")).toBeNull();
  });
});

/* ── parseShotDrafts 分镜拆分 ─────────────────────────────── */

describe("parseShotDrafts 从剧本拆分镜头", () => {
  it("Δ动作行成镜,Vx 台词归属最近的 Δ,时间地点来自标题", () => {
    const drafts = parseShotDrafts(SCRIPT);
    expect(drafts.length).toBeGreaterThanOrEqual(4);
    const first = drafts[0];
    expect(first?.sceneHeading).toContain("1-1");
    expect(first?.location).toBe("外·旧城区天台");
    expect(first?.time).toBe("黄昏");
    expect(first?.description).toContain("小满爬上天台");
    expect(first?.dialogue).toBe("小满:你是谁?为什么会说话?");
    expect(first?.firstInScene).toBe(true);
    const second = drafts[1];
    expect(second?.description).toContain("旧收音机");
    expect(second?.dialogue).toBe("阿声:我播放未来的声音。");
    expect(second?.firstInScene).toBe(false);
  });

  it("Δ 之前出现的 Vx 台词归入该场景首镜", () => {
    const drafts = parseShotDrafts("1-1 场景 内 房间(夜晚)\nV1 旁白:夜色渐深。\nΔ灯亮起。");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.dialogue).toBe("旁白:夜色渐深。");
    expect(drafts[0]?.description).toBe("灯亮起。");
  });

  it("空剧本 / 无结构文本 / 只有标题的块返回空数组", () => {
    expect(parseShotDrafts("")).toEqual([]);
    expect(parseShotDrafts("完全没有任何结构标记的普通段落。\n再来一段。")).toEqual([]);
    expect(parseShotDrafts("1-1 场景 外 天台(黄昏)\n\n1-2 场景 内 房间(夜晚)")).toEqual([]);
  });

  it("全文无场景标题但有 Δ/V 行时,整篇视为一个未命名场景", () => {
    const drafts = parseShotDrafts("Δ小满上场。\nV1 小满:大家好。");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.sceneHeading).toBe("未命名场景");
    expect(drafts[0]?.firstInScene).toBe(true);
  });

  it("多场景块各自重置 firstInScene,已知角色名按出场匹配", () => {
    const drafts = parseShotDrafts(SCRIPT, ["小满", "阿声"]);
    const block1 = drafts.filter((d) => d.sceneHeading.includes("1-1"));
    const block2 = drafts.filter((d) => d.sceneHeading.includes("1-2"));
    expect(block2[0]?.firstInScene).toBe(true);
    expect(block1[0]?.characterNames).toEqual(["小满"]);
    const last = drafts[drafts.length - 1];
    expect(last?.sceneHeading).toContain("天台对峙");
    expect(last?.characterNames).toContain("小满");
    expect(last?.characterNames).toContain("阿声");
  });

  it("draftToShotEntry:场景首镜默认远景,其余中景", () => {
    const drafts = parseShotDrafts("1-1 场景 外 天台(黄昏)\nΔ甲。\nΔ乙。");
    expect(draftToShotEntry(drafts[0]!).shotType).toBe("wide");
    expect(draftToShotEntry(drafts[1]!).shotType).toBe("medium");
  });
});

/* ── LLM 回复解析(本地 / 配置API 通道) ───────────────────── */

describe("parseExtractedCharacters 解析 LLM 角色卡 JSON", () => {
  it("容忍代码围栏与前后杂文,并丢弃缺 name 的元素", () => {
    const text = '好的,结果如下:\n```json\n[{"name":"小满","appearance":"短发"},{"costume":"裙子"}]\n```\n以上。';
    const drafts = parseExtractedCharacters(text);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.name).toBe("小满");
    expect(drafts[0]?.appearance).toBe("短发");
    expect(drafts[0]?.styleTags).toEqual([]);
  });

  it("非法 JSON 抛错,供组件层降级提示", () => {
    expect(() => parseExtractedCharacters("完全不是 JSON")).toThrow();
    expect(() => parseExtractedCharacters('{"name":"不是数组"}')).toThrow();
  });
});

describe("parseExtractedShots 解析 LLM 分镜 JSON", () => {
  it("非法景别回退 medium,缺 sceneHeading/description 的条目跳过", () => {
    const text = `[{"sceneHeading":"1-1 场景","shotType":"close","description":"甲抬头","characterNames":["小满"],"dialogue":"V1 台词"},
      {"name":"小满","appearance":"角色卡混入"},
      {"sceneHeading":"","shotType":"wide","description":""}]`;
    const entries = parseExtractedShots(text);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.shotType).toBe("close");
    expect(entries[0]?.characterNames).toEqual(["小满"]);
  });

  it("非数组 JSON 抛错", () => {
    expect(() => parseExtractedShots("不是 JSON")).toThrow();
  });
});

/* ── 外部导入:角色卡 JSON ────────────────────────────────── */

describe("parseImportedCharacterCards 导入角色卡 JSON", () => {
  it("支持数组、单对象与 characters 包装", () => {
    const card = { name: "小满", ageGender: "女", appearance: "短发", styleTags: ["厚涂"], skillSlug: "pixar", params: { steps: 25 } };
    for (const raw of [JSON.stringify([card]), JSON.stringify(card), JSON.stringify({ characters: [card] })]) {
      const drafts = parseImportedCharacterCards(raw);
      expect(drafts).toHaveLength(1);
      expect(drafts[0]?.skillSlug).toBe("pixar");
      expect(drafts[0]?.params).toEqual({ steps: 25 });
    }
  });

  it("缺 name 的条目跳过,全部无效时抛错", () => {
    expect(() => parseImportedCharacterCards('[{"appearance":"无名"}]')).toThrow();
    expect(() => parseImportedCharacterCards("not json")).toThrow();
    expect(() => parseImportedCharacterCards('{"foo":1}')).toThrow();
  });
});

/* ── 写入既有结构:mergeCharacterDrafts / buildShotsFromEntries ── */

describe("mergeCharacterDrafts 草稿并入角色列表", () => {
  it("重名跳过,新角色提示词按样式重算且 params 合并", () => {
    const existing = [makeCharacter({ name: "小满" })];
    const res = mergeCharacterDrafts(
      existing,
      [
        { name: "小满", ageGender: "", appearance: "", costume: "", personality: "", temperament: "", styleTags: [] },
        { name: "阿声", ageGender: "", appearance: "复古收音机", costume: "", personality: "神秘", temperament: "", styleTags: ["厚涂"] },
      ],
      STYLES
    );
    expect(res.added).toBe(1);
    expect(res.skipped).toBe(1);
    expect(res.list).toHaveLength(2);
    const added = res.list[1];
    expect(added?.name).toBe("阿声");
    expect(added?.positivePrompt).toContain("复古收音机");
    expect(added?.negativePrompt).toContain("realistic photo");
    expect(added?.params).toEqual({ steps: 30, cfg: 6.5 });
  });
});

describe("buildShotsFromEntries 条目写入分镜", () => {
  it("场景按标题匹配(精确与包含),角色按名字关联,镜号顺延,台词写入", () => {
    const scenes = [makeScene(), makeScene({ id: "scene_2", heading: "场景2 · 出租屋" })];
    const characters = [makeCharacter(), makeCharacter({ id: "char_2", name: "阿声" })];
    const shots = buildShotsFromEntries(
      [
        { sceneHeading: "1-1 场景 外 旧城区天台(黄昏)", shotType: "wide", description: "天台初遇", characterNames: ["小满"], dialogue: "小满:你好" },
        { sceneHeading: "场景2", shotType: "close", description: "书桌特写", characterNames: ["路人"], dialogue: "" },
      ],
      3,
      scenes,
      characters
    );
    expect(shots).toHaveLength(2);
    expect(shots[0]?.index).toBe(4);
    expect(shots[0]?.sceneId).toBe("scene_1");
    expect(shots[0]?.characterIds).toEqual(["char_1"]);
    expect(shots[0]?.dialogue).toBe("小满:你好");
    expect(shots[0]?.prompt).toContain("天台初遇");
    expect(shots[0]?.status).toBe("idle");
    expect(shots[1]?.sceneId).toBe("scene_2");
    expect(shots[1]?.characterIds).toEqual([]);
    expect(shots[1]?.dialogue).toBeUndefined();
    expect(matchSceneByHeading("不存在的场景", scenes)).toBeUndefined();
  });
});

/* ── LLM 消息构建 ─────────────────────────────────────────── */

describe("buildExtractCharactersMessages / buildExtractShotsMessages", () => {
  it("system+user 两段式消息,超长剧本截断到 8000 字符", () => {
    const long = "x".repeat(9000);
    const chars = buildExtractCharactersMessages(long);
    expect(chars).toHaveLength(2);
    expect(chars[0]?.role).toBe("system");
    expect(chars[1]?.content.length).toBeLessThanOrEqual(8000 + "剧本全文:\n".length);
    const shots = buildExtractShotsMessages("剧本", ["小满", " ", "阿声"]);
    expect(shots[1]?.content).toContain("小满、阿声");
  });
});
