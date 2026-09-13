import { describe, expect, it } from "vitest";

import type { Character, CharacterPortrait } from "./types";
import {
  MAX_PORTRAIT_CANDIDATES,
  MAX_PORTRAIT_LOG,
  appendPortraitLog,
  makePortraitLog,
  normalizePortrait,
  portraitCandidates,
  withPortraitCandidate,
  withSelectedPortrait,
  withoutPortraitCandidate,
} from "./character-portrait";

function makeCharacter(patch: Partial<Character> = {}): Character {
  return {
    id: "char-1",
    name: "阿跃",
    ageGender: "14岁少年",
    appearance: "",
    costume: "",
    personality: "",
    temperament: "",
    styleTags: [],
    positivePrompt: "14岁少年, 快递少年体型",
    negativePrompt: "low quality",
    params: {},
    ...patch,
  };
}

function makePortrait(patch: Partial<CharacterPortrait> = {}): CharacterPortrait {
  return {
    url: "/api/generated/t1/a.png",
    source: "local",
    createdAt: 1_000,
    ...patch,
  };
}

describe("normalizePortrait 脏数据归一化", () => {
  it("没有可用 url 的条目一律丢弃", () => {
    expect(normalizePortrait(null)).toBeNull();
    expect(normalizePortrait("a.png")).toBeNull();
    expect(normalizePortrait({})).toBeNull();
    expect(normalizePortrait({ url: "" })).toBeNull();
  });

  it("旧草稿缺 source / createdAt 时给出安全缺省", () => {
    expect(normalizePortrait({ url: "/u/a.png" })).toEqual({
      url: "/u/a.png",
      source: "import",
      createdAt: 0,
    });
  });

  it("保留 model / taskId，非法来源回退为导入", () => {
    const portrait = normalizePortrait({
      url: "/u/a.png",
      source: "cloud",
      model: "sdxl.safetensors",
      taskId: "task-9",
      createdAt: 5,
    });
    expect(portrait).toEqual({
      url: "/u/a.png",
      source: "import",
      createdAt: 5,
      model: "sdxl.safetensors",
      taskId: "task-9",
    });
  });
});

describe("portraitCandidates 读取候选", () => {
  it("无 portraits 字段（旧数据）返回空数组", () => {
    expect(portraitCandidates(makeCharacter())).toEqual([]);
    expect(portraitCandidates(makeCharacter({ portraits: "x" as never }))).toEqual([]);
  });

  it("按时间倒序返回，坏条目被剔除", () => {
    const character = makeCharacter({
      portraits: [
        makePortrait({ url: "/u/old.png", createdAt: 1 }),
        { url: "" } as CharacterPortrait,
        makePortrait({ url: "/u/new.png", createdAt: 9 }),
      ],
    });
    expect(portraitCandidates(character).map((item) => item.url)).toEqual([
      "/u/new.png",
      "/u/old.png",
    ]);
  });
});

describe("withPortraitCandidate 追加候选", () => {
  it("第一张候选自动成为定妆照，后续候选不抢已定妆照", () => {
    const first = withPortraitCandidate(makeCharacter(), makePortrait({ url: "/u/a.png" }));
    expect(first.portraitUrl).toBe("/u/a.png");

    const second = withPortraitCandidate(first, makePortrait({ url: "/u/b.png", createdAt: 2 }));
    expect(second.portraitUrl).toBe("/u/a.png");
    expect(second.portraits?.map((item) => item.url)).toEqual(["/u/b.png", "/u/a.png"]);
  });

  it("同一地址重复加入只保留一条并提到最新", () => {
    const character = withPortraitCandidate(
      makeCharacter({ portraits: [makePortrait({ url: "/u/a.png", createdAt: 1 })] }),
      makePortrait({ url: "/u/a.png", createdAt: 7, source: "remote" }),
    );
    expect(character.portraits).toHaveLength(1);
    expect(character.portraits?.[0]).toEqual({
      url: "/u/a.png",
      source: "remote",
      createdAt: 7,
    });
  });

  it("超出上限时丢掉最旧的一张", () => {
    const list = Array.from({ length: MAX_PORTRAIT_CANDIDATES }, (_, index) =>
      makePortrait({ url: `/u/${index}.png`, createdAt: index }),
    );
    const character = withPortraitCandidate(
      makeCharacter({ portraits: list }),
      makePortrait({ url: "/u/newest.png", createdAt: 999 }),
    );
    expect(character.portraits).toHaveLength(MAX_PORTRAIT_CANDIDATES);
    expect(character.portraits?.[0]?.url).toBe("/u/newest.png");
    expect(character.portraits?.some((item) => item.url === "/u/0.png")).toBe(false);
  });
});

describe("withSelectedPortrait 挑选定妆照", () => {
  it("命中候选才写入定妆照", () => {
    const character = makeCharacter({
      portraits: [makePortrait({ url: "/u/a.png" })],
    });
    expect(withSelectedPortrait(character, "/u/a.png").portraitUrl).toBe("/u/a.png");
    expect(withSelectedPortrait(character, "/u/ghost.png")).toBe(character);
  });
});

describe("withoutPortraitCandidate 删除候选", () => {
  const character = makeCharacter({
    portraits: [
      makePortrait({ url: "/u/a.png", createdAt: 1 }),
      makePortrait({ url: "/u/b.png", createdAt: 2 }),
    ],
    portraitUrl: "/u/a.png",
  });

  it("删非定妆照时定妆照不变", () => {
    const next = withoutPortraitCandidate(character, "/u/b.png");
    expect(next.portraitUrl).toBe("/u/a.png");
    expect(next.portraits?.map((item) => item.url)).toEqual(["/u/a.png"]);
  });

  it("删的正是定妆照时回落到剩下的最新一张", () => {
    const next = withoutPortraitCandidate(character, "/u/a.png");
    expect(next.portraitUrl).toBe("/u/b.png");
  });

  it("删光后不再留下悬空定妆照地址", () => {
    const one = withoutPortraitCandidate(
      makeCharacter({ portraits: [makePortrait({ url: "/u/a.png" })], portraitUrl: "/u/a.png" }),
      "/u/a.png",
    );
    expect(one.portraitUrl).toBeUndefined();
    expect("portraitUrl" in one).toBe(false);
    expect(one.portraits).toEqual([]);
  });
});

describe("appendPortraitLog 日志上限", () => {
  it("超出上限时丢最旧，长度封顶", () => {
    let list = appendPortraitLog([], makePortraitLog("info", "开始"));
    for (let index = 0; index < MAX_PORTRAIT_LOG + 10; index++) {
      list = appendPortraitLog(list, makePortraitLog("info", `第 ${index} 条`));
    }
    expect(list).toHaveLength(MAX_PORTRAIT_LOG);
    expect(list[0]?.text).toBe("第 10 条");
    expect(list[list.length - 1]?.text).toBe(`第 ${MAX_PORTRAIT_LOG + 9} 条`);
  });
});
