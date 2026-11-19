import { describe, expect, it } from "vitest";

import {
  buildIssueBody,
  buildIssueTitle,
  feedbackFileName,
  feedbackValidationReason,
  validateFeedbackDraft,
  type FeedbackDraft,
} from "./feedback-contract";

function draft(overrides: Partial<FeedbackDraft> = {}): FeedbackDraft {
  return {
    description: "点了生成没反应",
    images: [],
    environment: {
      appVersion: "1.2.3",
      platform: "Win32",
      userAgent: "test-agent",
      when: "2026-11-08 10:00:00",
    },
    includeDiagnostics: true,
    ...overrides,
  };
}

describe("validateFeedbackDraft（校验即类型守卫）", () => {
  it("完整草稿通过", () => {
    expect(validateFeedbackDraft(draft())).toBe(true);
  });

  it("带一张 data URL 截图通过", () => {
    expect(
      validateFeedbackDraft(
        draft({ images: [{ dataUrl: "data:image/png;base64,AAAA", name: "a.png" }] }),
      ),
    ).toBe(true);
  });

  it("缺描述 / 空描述被拒", () => {
    expect(validateFeedbackDraft({ ...draft(), description: "  " })).toBe(false);
    expect(feedbackValidationReason({ ...draft(), description: "  " })).toBe("请填写问题描述");
  });

  it("超长描述被拒并给出上限", () => {
    const tooLong = draft({ description: "x".repeat(8001) });
    expect(validateFeedbackDraft(tooLong)).toBe(false);
    expect(feedbackValidationReason(tooLong)).toContain("8000");
  });

  it("图片超过上限 / 形状不对被拒", () => {
    const many = draft({
      images: Array.from({ length: 7 }, () => ({
        dataUrl: "data:image/png;base64,AAAA",
        name: "a.png",
      })),
    });
    expect(validateFeedbackDraft(many)).toBe(false);
    expect(feedbackValidationReason(many)).toContain("6");
    expect(
      validateFeedbackDraft(draft({ images: [{ dataUrl: "not-a-data-url", name: "a.png" }] })),
    ).toBe(false);
  });

  it("环境信息缺字段 / 非对象被拒（不是「形状像就算」）", () => {
    const broken = { ...draft(), environment: { appVersion: "1" } };
    expect(validateFeedbackDraft(broken)).toBe(false);
    expect(validateFeedbackDraft(null)).toBe(false);
  });

  it("畸形 JSON（数组 / null）不当成草稿", () => {
    expect(validateFeedbackDraft([])).toBe(false);
    expect(validateFeedbackDraft(null)).toBe(false);
    expect(feedbackValidationReason(null)).toBe("反馈内容格式不正确");
  });
});

describe("buildIssueTitle / buildIssueBody / feedbackFileName", () => {
  it("标题取描述首行、压掉换行、长度封顶", () => {
    expect(buildIssueTitle("生成卡住\n日志里全是红")).toBe("[运行反馈] 生成卡住");
    expect(buildIssueTitle("   ")).toBe("[运行反馈] 应用运行反馈");
    expect(buildIssueTitle("x".repeat(200)).length).toBeLessThanOrEqual(80 + "[运行反馈] ".length);
  });

  it("正文含问题描述 / 环境 / 附件说明三段", () => {
    const d = draft({
      images: [{ dataUrl: "data:image/png;base64,AAAA", name: "a.png" }],
      includeDiagnostics: true,
    });
    const body = buildIssueBody(d, "feedback-20261108-100000-000");
    expect(body).toContain("## 问题描述");
    expect(body).toContain("点了生成没反应");
    expect(body).toContain("应用版本：1.2.3");
    expect(body).toContain("1 张截图");
    expect(body).toContain("诊断日志（zip）");
    expect(body).toContain("feedback-20261108-100000-000");
  });

  it("没图 / 没诊断时如实写「未附加」，不编出附件", () => {
    const body = buildIssueBody(draft({ includeDiagnostics: false }), "pkg");
    expect(body).toContain("本次反馈未附加截图");
    expect(body).toContain("本次反馈未附带诊断日志");
    expect(body).not.toContain("张截图，见");
  });

  it("版本缺值回落到 APP_VERSION（不在正文里写空）", () => {
    const d = draft({ environment: { ...draft().environment, appVersion: "" } });
    expect(buildIssueBody(d, "pkg")).not.toContain("应用版本：\n");
  });

  it("文件名带 feedback- 前缀且不改传入的 stamp", () => {
    expect(feedbackFileName("20261108-100000-000")).toBe("feedback-20261108-100000-000");
  });
});

describe("feedbackIssueUrl（已建 Issue 链接）", () => {
  it("用同一份仓库坐标与站点根拼链接", async () => {
    const { feedbackIssueUrl, FEEDBACK_CNB_WEB, FEEDBACK_REPO_SLUG } =
      await import("./feedback-contract");
    expect(feedbackIssueUrl("3390")).toBe(
      `${FEEDBACK_CNB_WEB}/${FEEDBACK_REPO_SLUG}/-/issues/3390`,
    );
  });

  it("新建页与已建链接同根（端点收口，不各写一份域名）", async () => {
    const { FEEDBACK_NEW_ISSUE_URL, FEEDBACK_CNB_WEB, FEEDBACK_REPO_SLUG } =
      await import("./feedback-contract");
    expect(FEEDBACK_NEW_ISSUE_URL.startsWith(`${FEEDBACK_CNB_WEB}/${FEEDBACK_REPO_SLUG}`)).toBe(
      true,
    );
  });
});
