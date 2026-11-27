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

  it("旧版本被服务端拒绝（stale:true）→ 触发可行动提示，不静默覆盖（ISSUE #5208）", async () => {
    const onStale = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response('{"ok":true,"stale":true}', { status: 200 }))),
    );
    await pushProduction("proj_1", payload, {
      expectedUpdatedAt: "2026-11-27T00:00:00.000Z",
      onStale,
    });
    expect(onStale).toHaveBeenCalledTimes(1);
  });

  it("空 projectId → 不发请求（草稿本地缓存就是全部）", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await pushProduction("", payload);
    expect(spy).not.toHaveBeenCalled();
  });

  it("请求抛错 → 不抛给调用方，结论落 failed（下次自动保存再补推）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("network down");
      }),
    );
    await expect(pushProduction("proj_1", payload)).resolves.toBe("failed");
  });
});

/* ── 写侧结论三态（ISSUE #5147）─────────────────────────────
 *
 * 此前 `pushProduction` 回 `void`、把「写成功 / 被拒（stale）/ 网络失败」压成
 * 同一种静默 —— 而 #5147 的现场正是「覆盖发生了，界面却以为保存成功」。
 */
describe("pushProduction 的三态结论（#5147）", () => {
  const patch = { scriptMarkdown: "# 剧本" };

  function stubResponse(status: number, body: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status }))),
    );
  }

  it("成功 → written，并把 baseUpdatedAt 一起发出去", async () => {
    const spy = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ ok: true, updatedAt: 42 }), { status: 200 })),
    );
    vi.stubGlobal("fetch", spy);
    await expect(
      pushProduction("proj_1", patch, { expectedUpdatedAt: "2026-01-01T00:00:00.000Z" }),
    ).resolves.toBe("written");
    const init = spy.mock.calls[0]?.[1];
    const raw: unknown = init?.body;
    if (typeof raw !== "string") {
      throw new TypeError(`body 应当是 JSON 串，实际是 ${typeof raw}`);
    }
    expect(JSON.parse(raw)).toEqual({
      project: "proj_1",
      production: patch,
      ifUpdatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("服务端回 stale:true → stale（库没被覆盖，界面据此提示「采用服务端内容」）", async () => {
    stubResponse(200, { ok: true, stale: true, updatedAt: 42, production: { title: "AI 的" } });
    await expect(
      pushProduction("proj_1", patch, { expectedUpdatedAt: "2026-01-01T00:00:00.000Z" }),
    ).resolves.toBe("stale");
  });

  it("4xx / 5xx → failed（没有落地证明，不许读成 saved）", async () => {
    /* 三种状态各判一次：它们的结论必须一致 —— 客户端只区分「有事发生」与
     * 「没落地」，具体码归服务端日志。 */
    const results: Array<string> = [];
    for (const status of [400, 403, 500]) {
      stubResponse(status, { error: "不行" });
      // oxlint-disable-next-line no-await-in-loop -- 逐档换桩再判，顺序即语义
      results.push(await pushProduction("proj_1", patch));
    }
    expect(results).toEqual(["failed", "failed", "failed"]);
  });

  it("网络抛错 → failed（下次自动保存再补推）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("network down");
      }),
    );
    await expect(pushProduction("proj_1", patch)).resolves.toBe("failed");
  });

  it("空 projectId → failed，且一次请求都不发", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await expect(pushProduction("", patch)).resolves.toBe("failed");
    expect(spy).not.toHaveBeenCalled();
  });
});
