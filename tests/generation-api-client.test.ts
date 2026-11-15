/**
 * generation-api-client 的预览请求（ISSUE #3985）：中转按 kind 分流 image /
 * video，预览体必须显式带 kind —— 漏了会被中转 400（「kind 必须是 image 或
 * video」），测试模型页选完模型就报错。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiPreviewRequest } from "../src/lib/workshop/generation-api-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiPreviewRequest（ISSUE #3985）", () => {
  it("预览请求显式带 kind 与 dryRun", async () => {
    let capturedBody = "";
    const fetchMock = vi.fn((_url: string | URL, init?: RequestInit) => {
      capturedBody = typeof init?.body === "string" ? init.body : "";
      return Promise.resolve(new Response(JSON.stringify({ debug: [] }), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const rows = await apiPreviewRequest({ model: "m", mode: "T2V", prompt: "p" }, "video");
    expect(rows).toEqual([]);
    expect(capturedBody).toContain('"kind":"video"');
    expect(capturedBody).toContain('"dryRun":true');
    expect(capturedBody).toContain('"model":"m"');
  });
});
