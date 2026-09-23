// fetchProduction 的契约（Phase 3c-1）：读回生产数据，失败/无行静默降级为 null。
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchProduction, fetchProductionProgress } from "./production-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockFetch(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
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
      vi.fn(async () => {
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
