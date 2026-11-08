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
