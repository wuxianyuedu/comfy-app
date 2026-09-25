import { afterEach, describe, expect, it, vi } from "vitest";
import { probeBaseOnce } from "./probe";

/** 造一个 fetch 桩：给定状态码即返回对应 Response（默认 2xx 为 ok）。 */
function fetchStub(status: number, ok = status >= 200 && status < 300) {
  return vi.fn(async () => ({ ok, status }) as unknown as Response);
}

describe("probeBaseOnce — 存活探针（连通即存活，#685）", () => {
  afterEach(() => vi.restoreAllMocks());

  it("端口应答 200 → 返回 base（实例在跑）", async () => {
    vi.stubGlobal("fetch", fetchStub(200));
    expect(await probeBaseOnce("http://127.0.0.1:8188")).toBe(
      "http://127.0.0.1:8188",
    );
  });

  it("端口应答 500（GPU 显存不足）仍视为存活 → 返回 base，不误报未运行", async () => {
    vi.stubGlobal("fetch", fetchStub(500, false));
    expect(await probeBaseOnce("http://127.0.0.1:8188")).toBe(
      "http://127.0.0.1:8188",
    );
  });

  it("连接失败（ECONNREFUSED）→ 返回 null（实例确实不在）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    expect(await probeBaseOnce("http://127.0.0.1:8188")).toBeNull();
  });

  it("超时可按场景注入（端口扫描给短预算），默认 1500ms 不变", async () => {
    vi.stubGlobal("fetch", fetchStub(200));
    const spy = vi.spyOn(AbortSignal, "timeout");
    await probeBaseOnce("http://127.0.0.1:8188", 300);
    await probeBaseOnce("http://127.0.0.1:8188");
    expect(spy.mock.calls.map(([ms]) => ms)).toEqual([300, 1500]);
  });
});
