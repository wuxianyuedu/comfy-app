// generation-log-client 的结果分型（#4242）：失败（网络错 / HTTP 非 2xx / 坏载荷）
// 与「真的没有历史」不再折叠成同一个空数组——调用方据此给「拉取失败，请重试」
// 而不是谎报「没有历史」。fetchWithTimeout 桩掉（不发真网络）。
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchWithTimeoutMock = vi.hoisted(() => vi.fn());

vi.mock("~/lib/network/fetch-with-timeout", () => ({
  fetchWithTimeout: fetchWithTimeoutMock,
}));

import { fetchGenerationLogs } from "./generation-log-client";

/** 造一个 Response 形状的 Minimal 桩（fetchWithTimeout 的返回只被读 ok / json）。 */
function jsonResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    json: async () => payload,
  } as unknown as Response;
}

beforeEach(() => {
  fetchWithTimeoutMock.mockReset();
});

describe("fetchGenerationLogs 的结果分型（#4242）", () => {
  it("成功：条目按「有非空 summary」过滤，ok=true", async () => {
    fetchWithTimeoutMock.mockResolvedValue(
      jsonResponse({
        entries: [{ summary: "有内容的行" }, { summary: "" }, "不是对象", { summary: "第二条" }],
      }),
    );

    const res = await fetchGenerationLogs("portrait", 100);

    expect(res.ok).toBe(true);
    expect(res.entries.map((e) => e.summary)).toEqual(["有内容的行", "第二条"]);
  });

  it("网络异常 / HTTP 非 2xx / 坏载荷：ok=false（不再折成空数组）", async () => {
    fetchWithTimeoutMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(fetchGenerationLogs("portrait")).resolves.toMatchObject({ ok: false });

    fetchWithTimeoutMock.mockResolvedValue(jsonResponse({}, false));
    await expect(fetchGenerationLogs("portrait")).resolves.toMatchObject({ ok: false });

    fetchWithTimeoutMock.mockResolvedValue(jsonResponse({ nope: true }));
    await expect(fetchGenerationLogs("portrait")).resolves.toMatchObject({ ok: false });
  });

  it("成功但确无条目：ok=true 且 entries 为空（空态是真的空）", async () => {
    fetchWithTimeoutMock.mockResolvedValue(jsonResponse({ entries: [] }));

    const res = await fetchGenerationLogs("portrait");

    expect(res).toEqual({ entries: [], ok: true });
  });
});
