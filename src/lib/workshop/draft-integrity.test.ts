/**
 * 草稿元素级判据（台账 F13″）。
 *
 * 钉的是三条承诺，缺一条这个功能就是有害的：
 *   ① **不丢数据** —— 认不出的元素必须原样留在数组里、还在原来的下标上；
 *   ② **不静默** —— 留下来的每一条都必须被报出来（「保留 = 这处继续不校验」正是本条要拦的）；
 *   ③ **不挑刺** —— 干净元素（含可选字段缺席）一条都不许报，否则「需要修复」会被当噪音关掉。
 * ①② 的配对由最后那组用例直接喂 `parseDraftDto` 判：**同一条脏数据既要还在、又要被报**，
 * 两边任何一边退化都会红（把 `parseDraftDto` 改成过滤脏元素 → ① 红；
 * 把判据表漏一个字段 → ② 红）。
 */
import { describe, expect, it } from "vitest";

import { parseDraftDto } from "./draft-sync-shared";
import {
  auditDraftElements,
  countAffectedElements,
  describeDraftIssues,
  type DraftElements,
} from "./draft-integrity";

const CLEAN_SCENES = [
  {
    id: "s1",
    heading: "清晨的咖啡馆",
    location: "咖啡馆",
    time: "晨",
    action: "她推门进来",
    dialogue: "",
    shotCount: 3,
  },
];
const CLEAN_CHARACTERS = [
  {
    id: "c1",
    name: "小美",
    ageGender: "25 女",
    appearance: "",
    costume: "",
    personality: "",
    temperament: "",
    styleTags: ["皮克斯", "厚涂"],
    positivePrompt: "",
    negativePrompt: "",
  },
];
const CLEAN_SHOTS = [
  {
    id: "sh1",
    index: 1,
    sceneId: "s1",
    sceneHeading: "清晨的咖啡馆",
    shotType: "medium",
    description: "推门",
    characterIds: ["c1"],
    prompt: "a girl pushing the door",
    negativePrompt: "",
    status: "idle",
  },
];

function draftOf(over: Partial<DraftElements> = {}): DraftElements {
  return {
    scenes: CLEAN_SCENES,
    characters: CLEAN_CHARACTERS,
    shots: CLEAN_SHOTS,
    ...over,
  };
}

describe("③ 不挑刺：干净元素一条都不报", () => {
  it("三类各一条干净的 → 无结论", () => {
    expect(auditDraftElements(draftOf())).toEqual([]);
    expect(describeDraftIssues(auditDraftElements(draftOf()))).toBeNull();
  });

  it("可选字段整体缺席不算问题（老草稿没有 params / portraits 也要读得开）", () => {
    expect(
      auditDraftElements(
        draftOf({
          characters: [{ id: "c9", name: "无参数", styleTags: [] }],
          shots: [{ ...CLEAN_SHOTS[0], taskId: undefined }],
        }),
      ),
    ).toEqual([]);
  });

  it("空数组不算问题（没写不等于写坏）", () => {
    expect(
      auditDraftElements({ scenes: [], characters: [], shots: [] }),
    ).toEqual([]);
  });
});

describe("② 不静默：每一种脏法都要被点名", () => {
  /** 每个用例给一份「只有某一处脏」的草稿，断言报出来的 `kind + field`。 */
  const cases: Array<{
    name: string;
    draft: DraftElements;
    expect: Array<[string, string | null]>;
  }> = [
    {
      name: "场景缺 id",
      draft: draftOf({ scenes: [{ ...CLEAN_SCENES[0], id: "" }] }),
      expect: [["scene", "id"]],
    },
    {
      name: "场景 id 不是字符串",
      draft: draftOf({ scenes: [{ ...CLEAN_SCENES[0], id: 12 }] }),
      expect: [["scene", "id"]],
    },
    {
      name: "场景标题是数字",
      draft: draftOf({ scenes: [{ ...CLEAN_SCENES[0], heading: 3 }] }),
      expect: [["scene", "heading"]],
    },
    {
      name: "建议镜数是 NaN",
      draft: draftOf({ scenes: [{ ...CLEAN_SCENES[0], shotCount: NaN }] }),
      expect: [["scene", "shotCount"]],
    },
    {
      name: "建议镜数是数字字符串",
      draft: draftOf({ scenes: [{ ...CLEAN_SCENES[0], shotCount: "3" }] }),
      expect: [["scene", "shotCount"]],
    },
    {
      name: "角色 styleTags 是字符串",
      draft: draftOf({
        characters: [{ ...CLEAN_CHARACTERS[0], styleTags: "皮克斯" }],
      }),
      expect: [["character", "styleTags"]],
    },
    {
      name: "角色 styleTags 数组里混了数字",
      draft: draftOf({
        characters: [{ ...CLEAN_CHARACTERS[0], styleTags: ["皮克斯", 2] }],
      }),
      expect: [["character", "styleTags"]],
    },
    {
      name: "角色 params 是数组",
      draft: draftOf({
        characters: [{ ...CLEAN_CHARACTERS[0], params: [] }],
      }),
      expect: [["character", "params"]],
    },
    {
      name: "镜头缺 id",
      draft: draftOf({ shots: [{ ...CLEAN_SHOTS[0], id: undefined }] }),
      expect: [["shot", "id"]],
    },
    {
      name: "镜头镜号是字符串",
      draft: draftOf({ shots: [{ ...CLEAN_SHOTS[0], index: "1" }] }),
      expect: [["shot", "index"]],
    },
    {
      name: "镜头 prompt 是 null",
      draft: draftOf({ shots: [{ ...CLEAN_SHOTS[0], prompt: null }] }),
      expect: [["shot", "prompt"]],
    },
    {
      name: "镜头状态是未知取值",
      draft: draftOf({ shots: [{ ...CLEAN_SHOTS[0], status: "waiting" }] }),
      expect: [["shot", "status"]],
    },
    {
      name: "整条角色是字符串",
      draft: draftOf({ characters: ["小美"] }),
      expect: [["character", null]],
    },
    {
      name: "整条镜头是 null",
      draft: draftOf({ shots: [null] }),
      expect: [["shot", null]],
    },
    {
      name: "整条场景是数组",
      draft: draftOf({ scenes: [[]] }),
      expect: [["scene", null]],
    },
  ];

  for (const item of cases) {
    it(item.name, () => {
      const issues = auditDraftElements(item.draft);
      expect(issues.map((issue) => [issue.kind, issue.field])).toEqual(
        item.expect,
      );
      // 每一条都得带一句能行动的原因
      for (const issue of issues)
        expect(issue.reason.length).toBeGreaterThan(8);
    });
  }

  it("枚举取值跟着 types.ts 走：新增一个 ShotStatus 不必改判据", async () => {
    const { SHOT_STATUSES } = await import("./types");
    const known = SHOT_STATUSES[SHOT_STATUSES.length - 1];
    expect(
      auditDraftElements(
        draftOf({ shots: [{ ...CLEAN_SHOTS[0], status: known }] }),
      ),
    ).toEqual([]);
  });
});

describe("① 不丢数据：脏元素留在原地，下标指得回去", () => {
  it("脏元素还在原下标上，且入参没被改动", () => {
    const dirtyCharacter = { id: "c2", name: "老张", styleTags: "厚涂" };
    const draft: DraftElements = {
      scenes: CLEAN_SCENES,
      characters: [CLEAN_CHARACTERS[0], dirtyCharacter],
      shots: CLEAN_SHOTS,
    };
    const snapshot = JSON.stringify(draft);
    const issues = auditDraftElements(draft);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.index).toBe(1);
    // 判据不许顺手「修好」它：改值就等于替用户决定
    expect(draft.characters[1]).toBe(dirtyCharacter);
    expect(JSON.stringify(draft)).toBe(snapshot);
  });

  it("同一条元素坏两个字段 → 两条结论、一条元素", () => {
    const draft = draftOf({
      shots: [{ ...CLEAN_SHOTS[0], id: "", prompt: 5 }],
    });
    const issues = auditDraftElements(draft);
    expect(issues.map((issue) => issue.field).sort()).toEqual(["id", "prompt"]);
    expect(countAffectedElements(issues).shot).toBe(1);
  });

  it("label 带着能定位的两件事：种类 + 下标 +（能读到就有的）id", () => {
    const issues = auditDraftElements(
      draftOf({ characters: [{ id: "c7", name: "小美", styleTags: 3 }] }),
    );
    expect(issues[0]?.label).toBe("角色 #1「c7」");
    const noId = auditDraftElements(
      draftOf({ characters: [{ name: "没有 id", styleTags: [] }] }),
    );
    expect(noId[0]?.label).toBe("角色 #1");
    // 可选字段缺席不报（否则每条老草稿都会被念一遍）—— 只报真正缺的那个 id
    expect(noId.map((issue) => issue.field)).toEqual(["id"]);
  });
});

describe("与 parseDraftDto 配对：脏数据既还在、又被报出来", () => {
  /** 这份 raw 从 localStorage / 请求体进来的形状：一条好角色 + 一条 `styleTags` 是字符串的。 */
  const RAW = {
    meta: { title: "T", type: "short_video", tone: "", logline: "" },
    scriptMarkdown: "",
    scenes: CLEAN_SCENES,
    characters: [
      CLEAN_CHARACTERS[0],
      { id: "c2", name: "老张", styleTags: "厚涂" },
    ],
    shots: [CLEAN_SHOTS[0], { index: "2", sceneId: "s1", characterIds: "c2" }],
  };

  it("① 解析后脏元素**一条都没少**（改成过滤就是红 —— 那是静默删用户数据）", () => {
    const draft = parseDraftDto(RAW);
    expect(draft.characters).toHaveLength(2);
    expect(draft.shots).toHaveLength(2);
    expect(draft.characters[1]).toEqual({
      id: "c2",
      name: "老张",
      styleTags: "厚涂",
    });
  });

  it("② 同一份解析结果过判据 → 脏的那两条都被点名（继续不判就是红）", () => {
    const draft = parseDraftDto(RAW);
    const issues = auditDraftElements(draft);
    // 按「哪几条元素」断言而不是数问题条数：一条元素可以坏好几个字段，
    // 数条数会把「漏判一个字段」这种退化算成通过。
    const affected = new Set(
      issues.map((issue) => `${issue.kind}#${String(issue.index)}`),
    );
    expect([...affected].sort()).toEqual(["character#1", "shot#1"]);
    // 干净的那两条绝不该被牵连
    expect(issues.some((issue) => issue.kind === "scene")).toBe(false);
    expect(issues.some((issue) => issue.index === 0)).toBe(false);
  });

  it("干净的一份草稿过这两关什么都看不见（不制造无病呻吟）", () => {
    const clean = parseDraftDto({
      ...RAW,
      characters: CLEAN_CHARACTERS,
      shots: CLEAN_SHOTS,
    });
    expect(auditDraftElements(clean)).toEqual([]);
  });
});

describe("界面那句话", () => {
  it("按种类合并计数，顺序稳定（场景 → 角色 → 镜头）", () => {
    const issues = auditDraftElements(
      draftOf({
        scenes: [{ heading: "x" }],
        characters: [{ id: "c1", styleTags: 1 }],
        shots: [{ id: "" }],
      }),
    );
    expect(describeDraftIssues(issues)).toBe(
      "草稿里有 1 场景、1 角色、1 镜头 的形状不认识，已原样保留但需要修复",
    );
  });

  it("同种类多条只数一次条数，不数问题数", () => {
    const issues = auditDraftElements(
      draftOf({ shots: [{ id: "" }, { id: "ok", prompt: 1 }] }),
    );
    expect(issues.length).toBeGreaterThan(2);
    expect(describeDraftIssues(issues)).toContain("2 镜头");
  });
});
