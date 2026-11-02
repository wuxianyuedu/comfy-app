// buildProductionPayload 的契约（Phase 3b-2 抽出，3c-2b 复用）：
// 把工坊草稿摊平成生产数据写入载荷，进度取入参的 stage/rendered。
// 保存继承（#2615）：草稿缺键的机器衍生字段从库中同 id 记录继承。
import { describe, expect, it } from "vitest";

import { buildProductionPayload, inheritDerivedFields, SHOT_DERIVED_FIELDS } from "./payload";
import { emptyWorkshopDraft, type WorkshopDraft } from "~/lib/workshop/draft-store";
import type { Shot } from "~/lib/workshop/types";

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
      /* SAFETY: 类型断言已复核 */
      shots: [{ id: "a" } as Shot],
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

  it("非对象记录原样穿过，不抛", () => {
    expect(
      inheritDerivedFields([null, 42, { id: "shot-1" }], existing, SHOT_DERIVED_FIELDS),
    ).toEqual([null, 42, expect.objectContaining({ id: "shot-1", rev: 3 })]);
  });
});
