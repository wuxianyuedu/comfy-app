import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readComfyErrorMessage,
  waitForComfyReady,
} from "./comfy-readiness-client";

function jsonRes(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readComfyErrorMessage", () => {
  it("优先取 detail（ensure 契约里的用户可见原因）", () => {
    expect(
      readComfyErrorMessage({ detail: "ComfyUI 未运行，且未开启自动启动" }, "兜底"),
    ).toBe("ComfyUI 未运行，且未开启自动启动");
  });

  it("兼容 {error} 字符串与 {error:{message}} 两种信封", () => {
    expect(readComfyErrorMessage({ error: "上传失败" }, "兜底")).toBe("上传失败");
    expect(readComfyErrorMessage({ error: { message: "未登录" } }, "兜底")).toBe(
      "未登录",
    );
  });

  it("空串与未知形态回落兜底，不渲染空白提示", () => {
    expect(readComfyErrorMessage({ detail: "   " }, "兜底")).toBe("兜底");
    expect(readComfyErrorMessage(undefined, "兜底")).toBe("兜底");
  });
});

describe("waitForComfyReady", () => {
  it("首次探活就可用 → 不等待，直接 ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(waitForComfyReady()).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("202（正在启动）→ 轮询到可用为止，并把进行态上抛一次", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes(202, { ok: false, pending: true, detail: "正在启动 ComfyUI" }))
      .mockResolvedValueOnce(jsonRes(202, { ok: false, pending: true, detail: "正在启动 ComfyUI" }))
      .mockResolvedValueOnce(jsonRes(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const onProgress = vi.fn();

    await expect(
      waitForComfyReady({ timeoutMs: 5_000, pollMs: 1, onProgress }),
    ).resolves.toEqual({ ok: true });
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith("正在启动 ComfyUI");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("明确失败（503 / pending=false）→ 立刻返回，不再空转重试", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonRes(503, { ok: false, pending: false, detail: "保活进程已退出" }));
    vi.stubGlobal("fetch", fetchMock);

    const r = await waitForComfyReady({ timeoutMs: 5_000, pollMs: 1 });
    expect(r).toEqual({ ok: false, pending: false, message: "保活进程已退出" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("一直 202 → 超时后给出「去设置页手动启动」的出口", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonRes(202, { ok: false, pending: true, detail: "正在启动 ComfyUI" })),
    );

    const r = await waitForComfyReady({ timeoutMs: 20, pollMs: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.pending).toBe(true);
      expect(r.message).toContain("正在启动 ComfyUI");
      expect(r.message).toContain("手动启动");
    }
  });

  it("网络层异常按「还在启动」处理，最终超时也算 pending", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const r = await waitForComfyReady({ timeoutMs: 20, pollMs: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.pending).toBe(true);
  });
});
