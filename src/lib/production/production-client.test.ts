// fetchProduction 的契约（Phase 3c-1）：读回生产数据，失败/无行静默降级为 null。
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchProduction, fetchProductionProgress, pushProduction } from "./production-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockFetch(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Response(JSON.stringify(body), {
          status: ok ? 200 : 500,
        }),
    ),
  );
}

describe("fetchProduction", () => {
  it("exists:true 时回传 production", async () => {
    mockFetch({
      exists: true,
      production: { title: "我的短剧", shots: [{ id: "s1" }] },
    });
    const got = await fetchProduction("proj_1");
    expect(got).toMatchObject({ title: "我的短剧" });
  });

  it("空 projectId → 直接 null（不发请求）", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(await fetchProduction("")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("exists:false → null", async () => {
    mockFetch({ exists: false });
    expect(await fetchProduction("proj_x")).toBeNull();
  });

  it("非 2xx → null", async () => {
    mockFetch({ error: "boom" }, false);
    expect(await fetchProduction("proj_1")).toBeNull();
  });

  it("请求抛错 → null（静默降级，不抛给调用方）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("network down");
      }),
    );
    expect(await fetchProduction("proj_1")).toBeNull();
  });
});

describe("fetchProductionProgress", () => {
  it("回读并规范化 progress", async () => {
    mockFetch({
      exists: true,
      production: { progress: { stage: "render", rendered: true } },
    });
    expect(await fetchProductionProgress("proj_1")).toEqual({
      stage: "render",
      rendered: true,
    });
  });

  it("progress 是脏 JSON → 宽容成默认（仍返回非 null，因该行存在）", async () => {
    mockFetch({ exists: true, production: { progress: { stage: "乱" } } });
    expect(await fetchProductionProgress("proj_1")).toEqual({
      stage: "script",
      rendered: false,
    });
  });

  it("无该行 → null", async () => {
    mockFetch({ exists: false });
    expect(await fetchProductionProgress("proj_x")).toBeNull();
  });

  it("空 projectId → null（不发请求）", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(await fetchProductionProgress("")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("pushProduction", () => {
  const payload = {
    characters: [],
    logline: "一句话",
    progress: { stage: "script" as const, rendered: false },
    scenes: [],
    scriptMarkdown: "# 剧本",
    shots: [],
    title: "T",
    tone: "轻松",
    type: "short_video",
  };

  it("PUT /api/production，body 里带 project + production 整份", async () => {
    const spy = vi.fn((_url: string, _init: { body?: unknown; method?: string }) =>
      Promise.resolve(new Response("{}", { status: 200 })),
    );
    vi.stubGlobal("fetch", spy);
    await pushProduction("proj_1", payload);
    expect(spy).toHaveBeenCalledTimes(1);
    const url = spy.mock.calls[0]?.[0];
    const init = spy.mock.calls[0]?.[1];
    expect(url).toBe("/api/production");
    expect(init?.method).toBe("PUT");
    /* body 是本函数自己 `JSON.stringify` 出来的串 —— 先钉类型再读回；
       不经 `String()`：那会把「body 被换成一个对象」的回归读成 `[object Object]` 照样过。 */
    const body: unknown = init?.body;
    if (typeof body !== "string") {
      throw new TypeError(`body 应当是 JSON 串，实际是 ${typeof body}`);
    }
    expect(JSON.parse(body)).toEqual({ project: "proj_1", production: payload });
  });

  it("空 projectId → 不发请求（草稿本地缓存就是全部）", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await pushProduction("", payload);
    expect(spy).not.toHaveBeenCalled();
  });

  it("请求抛错 → 静默吞掉，不抛给调用方（下次自动保存再补推）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("network down");
      }),
    );
    await expect(pushProduction("proj_1", payload)).resolves.toBeUndefined();
  });
});
