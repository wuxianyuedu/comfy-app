import { afterEach, describe, expect, it, vi } from "vitest";

import { submitFeedback } from "./feedback-client";
import type { FeedbackDraft } from "./feedback-contract";

function draft(): FeedbackDraft {
  return {
    description: "点了生成没反应",
    images: [],
    environment: {
      appVersion: "1.2.3",
      platform: "Win32",
      userAgent: "test-agent",
      when: "2026-11-08 10:00:00",
    },
    includeDiagnostics: false,
  };
}

/** 造一个真 Response（测试只认 status + json()）：避免 `as Response` 那类
 * 不安全断言，也让 `init.body` 是确定形态的字符串。 */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("submitFeedback（网络层）", () => {
  it("成功回执原样交给界面（含正文 / 标题 / 路径）", async () => {
    const ok = {
      ok: true,
      error: "",
      packagePath: "/abs/log/exports/feedback-x",
      packageName: "feedback-x",
      relativePath: "exports/feedback-x",
      imageCount: 2,
      diagnosticsIncluded: true,
      issueBody: "## 问题描述",
      issueTitle: "[运行反馈] 点了生成没反应",
    };
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(jsonResponse(200, ok)),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await submitFeedback(draft());
    expect(result.ok).toBe(true);
    expect(result.issueBody).toBe(ok.issueBody);
    expect(result.packagePath).toBe(ok.packagePath);
    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0];
    const init = call?.[1];
    expect(call?.[0]).toBe("/api/feedback/export");
    expect(init?.method).toBe("POST");
    const sentBody = typeof init?.body === "string" ? init.body : "{}";
    expect(JSON.parse(sentBody)).toMatchObject({ description: "点了生成没反应" });
  });

  it("业务失败（ok:false）转成同形状失败结果，不当成成功", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(200, { ok: false, error: "保存失败" }))),
    );
    const result = await submitFeedback(draft());
    expect(result.ok).toBe(false);
    expect(result.error).toBe("保存失败");
  });

  it("HTTP 失败读服务端错误信封", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(400, { error: "请填写问题描述" }))),
    );
    const result = await submitFeedback(draft());
    expect(result.ok).toBe(false);
    expect(result.error).toBe("请填写问题描述");
  });

  it("响应形状不合法 / 网络异常都给失败结果而不是抛", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(200, { nonsense: 1 }))),
    );
    expect((await submitFeedback(draft())).error).toContain("形状");

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    expect((await submitFeedback(draft())).error).toBe("offline");
  });
});

describe("getFeedbackCliStatus（环境探测）", () => {
  it("回执原样收窄", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(200, { available: true, reason: "" }))),
    );
    const { getFeedbackCliStatus } = await import("./feedback-client");
    await expect(getFeedbackCliStatus()).resolves.toEqual({ available: true, reason: "" });
  });

  it("形状不合法按不可用处理，不猜", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(200, { nonsense: 1 }))),
    );
    const { getFeedbackCliStatus } = await import("./feedback-client");
    const status = await getFeedbackCliStatus();
    expect(status.available).toBe(false);
    expect(status.reason).not.toBe("");
  });

  it("网络失败转成同形状不可用", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    const { getFeedbackCliStatus } = await import("./feedback-client");
    const status = await getFeedbackCliStatus();
    expect(status.available).toBe(false);
    expect(status.reason).toContain("offline");
  });
});

describe("publishFeedback（提交到仓库）", () => {
  it("成功回执原样交给界面", async () => {
    const ok = {
      ok: true,
      error: "",
      uploaded: 2,
      issueNumber: "3390",
      issueUrl: "https://cnb.cool/moon-read/comfy-app-t3/-/issues/3390",
    };
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(jsonResponse(200, ok)),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { publishFeedback } = await import("./feedback-client");
    await expect(publishFeedback("feedback-20261108-101010-123")).resolves.toEqual(ok);
    const sentBody = fetchMock.mock.calls[0]?.[1]?.body;
    expect(typeof sentBody === "string" ? JSON.parse(sentBody) : null).toEqual({
      packageName: "feedback-20261108-101010-123",
    });
  });

  it("业务失败只回一句原因，不带半截路径", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(200, { ok: false, error: "cnb cli 未登录" }))),
    );
    const { publishFeedback } = await import("./feedback-client");
    const result = await publishFeedback("feedback-x");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("cnb cli 未登录");
    expect(result.issueUrl).toBe("");
  });

  it("HTTP 失败走 readApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(403, { error: "无权限" }))),
    );
    const { publishFeedback } = await import("./feedback-client");
    const result = await publishFeedback("feedback-x");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("无权限");
  });
});
