// buildProductionPayload 的契约（Phase 3b-2 抽出，3c-2b 复用）：
// 把工坊草稿摊平成生产数据写入载荷，进度取入参的 stage/rendered。
// 保存继承（#2615）：草稿缺键的机器衍生字段从库中同 id 记录继承。
// 窄写入与挂载采纳（#5147）：双操作者（人 / AI）共读写侧的判据。
import { describe, expect, it } from "vitest";

import {
  buildProductionPayload,
  hasProductionContent,
  inheritDerivedFields,
  isProductionWriteEmpty,
  narrowProductionWrite,
  productionContentToDraft,
  shouldAdoptProduction,
  SHOT_DERIVED_FIELDS,
} from "./payload";
import { emptyWorkshopDraft, type WorkshopDraft } from "~/lib/workshop/draft-store";
import { shotInputSchema } from "~/lib/workshop/types";

describe("buildProductionPayload", () => {
  it("摊平 meta / 剧本 / 场景 / 角色 / 镜头，进度用入参 stage + rendered", () => {
    const draft: WorkshopDraft = {
      ...emptyWorkshopDraft(),
      meta: {
        ...emptyWorkshopDraft().meta,
        title: "我的短剧",
        type: "short_video",
        tone: "轻松",
        logline: "一句话",
      },
      scriptMarkdown: "# 剧本",
      shots: [shotInputSchema.parse({ id: "a", index: 0 })],
    };
    const payload = buildProductionPayload(draft, "storyboard", true);
    expect(payload).toMatchObject({
      title: "我的短剧",
      type: "short_video",
      tone: "轻松",
      logline: "一句话",
      scriptMarkdown: "# 剧本",
      shots: [{ id: "a" }],
      progress: { stage: "storyboard", rendered: true },
    });
  });
});

describe("inheritDerivedFields（#2615 保存继承）", () => {
  const existing = [
    {
      id: "shot-1",
      prompt: "库里的旧提示词",
      rev: 3,
      review: { pass: true, issues: [], suggestion: "", scoredAt: "t1" },
      imageReview: {
        pass: false,
        issues: ["手崩"],
        suggestion: "",
        scoredAt: "t2",
      },
      humanVerdict: { pass: false, note: "重画", at: "t3" },
      reviewHistory: [{ pass: false, issues: [], suggestion: "", scoredAt: "t0" }],
    },
    { id: "shot-gone", rev: 9 }, // 库里有、草稿已删 → 不出现在结果里
  ];

  it("草稿缺键的衍生字段按同 id 继承，内容字段以草稿为准", () => {
    const result = inheritDerivedFields(
      [{ id: "shot-1", prompt: "草稿的新提示词", status: "done" }],
      existing,
      SHOT_DERIVED_FIELDS,
    );
    expect(result).toEqual([
      {
        id: "shot-1",
        prompt: "草稿的新提示词",
        status: "done",
        rev: 3,
        review: existing[0]!.review,
        imageReview: existing[0]!.imageReview,
        humanVerdict: existing[0]!.humanVerdict,
        reviewHistory: existing[0]!.reviewHistory,
      },
    ]);
  });

  it("入参显式带了衍生字段 → 以入参为准（继承只兜「草稿不知道」）", () => {
    const mine = { pass: true, issues: [], suggestion: "", scoredAt: "mine" };
    const result = inheritDerivedFields(
      [{ id: "shot-1", rev: 7, review: mine }],
      existing,
      SHOT_DERIVED_FIELDS,
    );
    expect(result[0]).toMatchObject({ rev: 7, review: mine });
    // 入参没带的仍继承
    expect(result[0]).toMatchObject({ imageReview: existing[0]!.imageReview });
  });

  it("无 id 的入参记录原样保留；库里没有同 id 记录时不凭空造字段", () => {
    const odd = { prompt: "没有 id" };
    const fresh = { id: "shot-new", prompt: "新镜" };
    const result = inheritDerivedFields([odd, fresh], existing, SHOT_DERIVED_FIELDS);
    expect(result[0]).toBe(odd);
    expect(result[1]).toEqual(fresh);
  });

  it("库里的垃圾记录（非对象 / id 非字符串）不进索引，也不影响正常继承", () => {
    /* route 把 JSON 列原样读写，「库里那一列被人写脏」在真机上发生过（#2615 的同族）。
       索引阶段跳过它们，是这一层唯一的防御 —— 漏了就是把 `null` 当 id。 */
    const dirty = [null, 42, { id: 7, rev: 1 }, { id: "shot-1", rev: 3 }];
    const result = inheritDerivedFields(
      [{ id: "shot-1", prompt: "x" }],
      dirty,
      SHOT_DERIVED_FIELDS,
    );
    expect(result).toEqual([{ id: "shot-1", prompt: "x", rev: 3 }]);
  });

  it("非对象记录原样穿过，不抛", () => {
    expect(
      inheritDerivedFields([null, 42, { id: "shot-1" }], existing, SHOT_DERIVED_FIELDS),
    ).toEqual([null, 42, expect.objectContaining({ id: "shot-1", rev: 3 })]);
  });
});

/* ── 窄写入（ISSUE #5147 的主修）─────────────────────────────
 *
 * 复现的现场：AI 侧写进 6 场景 / 6 角色 / 19 镜，界面那份是挂载时读进来的
 * 旧草稿（这些列全空），一次自动保存就把它们清空。窄写入的回答是
 * 「用户没碰的字段一个字节都不发」，所以整片覆盖在结构上不可能发生。
 */
describe("narrowProductionWrite（#5147 窄写入）", () => {
  const base = {
    characters: [],
    logline: "",
    progress: { stage: "script" as const, rendered: false },
    scenes: [],
    scriptMarkdown: "",
    shots: [],
    title: "未命名项目",
    tone: "",
    type: "short_video" as const,
  };

  it("一个字都没改 → 空载荷（调用方据此连请求都不发）", () => {
    expect(isProductionWriteEmpty(narrowProductionWrite(base, { ...base }))).toBe(true);
  });

  it("只改剧本 → 载荷里只有 scriptMarkdown，角色卡 / 场景 / 分镜一个字节都不带", () => {
    /* 这正是本单的现场：界面只动了剧本，而库里那三列是 AI 写的。
       整份发会把它们清空；窄写入连键都不出现。 */
    const patch = narrowProductionWrite(base, { ...base, scriptMarkdown: "# 新剧本" });
    expect(patch).toEqual({ scriptMarkdown: "# 新剧本" });
    expect(Object.hasOwn(patch, "characters")).toBe(false);
    expect(Object.hasOwn(patch, "scenes")).toBe(false);
    expect(Object.hasOwn(patch, "shots")).toBe(false);
  });

  it("键序不同不算改动（结构比较，不是 JSON.stringify 逐字节比）", () => {
    const shotA = { id: "a", prompt: "p", params: { steps: 20, seed: 1 } };
    const shotB = { params: { seed: 1, steps: 20 }, prompt: "p", id: "a" };
    const left = { ...base, shots: [shotA] };
    const right = { ...base, shots: [shotB] };
    expect(isProductionWriteEmpty(narrowProductionWrite(left, right))).toBe(true);
  });

  it("元素顺序变了算改动（数组是有序的，不能当集合比）", () => {
    const left = { ...base, shots: [{ id: "a" }, { id: "b" }] };
    const right = { ...base, shots: [{ id: "b" }, { id: "a" }] };
    expect(narrowProductionWrite(left, right)).toEqual({ shots: right.shots });
  });

  it("新增 / 删除元素都算改动（清空镜头是用户的真实意图，要能落库）", () => {
    const withShots = { ...base, shots: [{ id: "a" }] };
    expect(narrowProductionWrite(withShots, base)).toEqual({ shots: [] });
  });

  it("进度变化单独进载荷（不必连带内容列）", () => {
    const patch = narrowProductionWrite(base, {
      ...base,
      progress: { stage: "storyboard", rendered: true },
    });
    expect(patch).toEqual({ progress: { stage: "storyboard", rendered: true } });
  });
});

describe("shouldAdoptProduction（#5147 挂载采纳）", () => {
  const filled = {
    title: "AI 的项目",
    type: "short_video",
    tone: "悬疑",
    logline: "一句话",
    scriptMarkdown: "# 剧本",
    scenes: [{ id: "sc1" }],
    characters: [{ id: "ch1" }],
    shots: [{ id: "sh1" }],
  };

  it("服务端没有实质内容 → 不采纳（没有东西可采纳）", () => {
    expect(
      shouldAdoptProduction({
        draftUpdatedAt: 1,
        localEmpty: true,
        production: { ...filled, scriptMarkdown: "", scenes: [], characters: [], shots: [] },
        productionUpdatedAt: 9,
      }),
    ).toBe(false);
  });

  it("服务端没有这一行 → 不采纳", () => {
    expect(
      shouldAdoptProduction({
        draftUpdatedAt: undefined,
        localEmpty: true,
        production: null,
        productionUpdatedAt: undefined,
      }),
    ).toBe(false);
  });

  it("本机草稿为空 → 采纳（清缓存 / 换设备后重新拿到 AI 的内容）", () => {
    expect(
      shouldAdoptProduction({
        draftUpdatedAt: undefined,
        localEmpty: true,
        production: filled,
        productionUpdatedAt: 9,
      }),
    ).toBe(true);
  });

  it("服务端严格更新 → 采纳（AI 在界面挂载之后写的内容）", () => {
    expect(
      shouldAdoptProduction({
        draftUpdatedAt: 100,
        localEmpty: false,
        production: filled,
        productionUpdatedAt: 200,
      }),
    ).toBe(true);
  });

  it("本机更新 / 两侧同时刻 → 不采纳（保持本机优先，同 #3905）", () => {
    for (const productionUpdatedAt of [99, 100]) {
      expect(
        shouldAdoptProduction({
          draftUpdatedAt: 100,
          localEmpty: false,
          production: filled,
          productionUpdatedAt,
        }),
      ).toBe(false);
    }
  });

  it("任一侧缺时刻（旧数据）→ 不采纳，行为与此前一致", () => {
    expect(
      shouldAdoptProduction({
        draftUpdatedAt: undefined,
        localEmpty: false,
        production: filled,
        productionUpdatedAt: 200,
      }),
    ).toBe(false);
    expect(
      shouldAdoptProduction({
        draftUpdatedAt: 100,
        localEmpty: false,
        production: filled,
        productionUpdatedAt: undefined,
      }),
    ).toBe(false);
  });
});

describe("hasProductionContent", () => {
  it("剧本 / 场景 / 角色 / 镜头任一非空即算有内容", () => {
    const blank = {
      title: "未命名项目",
      type: "short_video",
      tone: "",
      logline: "",
      scriptMarkdown: "",
      scenes: [],
      characters: [],
      shots: [],
    };
    expect(hasProductionContent(blank)).toBe(false);
    expect(hasProductionContent({ ...blank, scriptMarkdown: " " })).toBe(false);
    expect(hasProductionContent({ ...blank, scriptMarkdown: "x" })).toBe(true);
    expect(hasProductionContent({ ...blank, scenes: [{}] })).toBe(true);
    expect(hasProductionContent({ ...blank, characters: [{}] })).toBe(true);
    expect(hasProductionContent({ ...blank, shots: [{}] })).toBe(true);
  });
});

describe("productionContentToDraft（#5147 采纳落地）", () => {
  const local = {
    ...emptyWorkshopDraft(),
    workflowId: "wf-local",
    videoWorkflowId: "wf-video-local",
    modelSelections: { shot: { mode: "", model: "wf::wf-local" } },
  };

  it("搬内容列，保留本机设备选择（模型 / 工作流 id 不属于服务端内容）", () => {
    const draft = productionContentToDraft(
      {
        title: "AI 的项目",
        type: "micro_film",
        tone: "悬疑",
        logline: "一句话",
        scriptMarkdown: "# 剧本",
        scenes: [{ id: "sc1" }],
        characters: [{ id: "ch1" }],
        shots: [{ id: "sh1" }],
      },
      local,
    );
    expect(draft.meta).toMatchObject({
      title: "AI 的项目",
      type: "micro_film",
      tone: "悬疑",
      logline: "一句话",
    });
    expect(draft.scriptMarkdown).toBe("# 剧本");
    expect(draft.scenes).toEqual([{ id: "sc1" }]);
    expect(draft.characters).toEqual([{ id: "ch1" }]);
    expect(draft.shots).toEqual([{ id: "sh1" }]);
    expect(draft.modelSelections).toEqual(local.modelSelections);
    expect(draft.workflowId).toBe("wf-local");
    expect(draft.videoWorkflowId).toBe("wf-video-local");
  });

  it("数据库里的 type 不在词表 → 保留本机值（不把垃圾值塞进草稿的 union）", () => {
    const draft = productionContentToDraft(
      {
        title: "T",
        type: "不认识的类型",
        tone: "",
        logline: "",
        scriptMarkdown: "",
        scenes: [],
        characters: [],
        shots: [],
      },
      local,
    );
    expect(draft.meta.type).toBe(local.meta.type);
  });
});
