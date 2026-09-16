// 上传素材的「ComfyUI 未就绪」链路：ISSUE #345 的回归护栏。
// 此前未运行时直接抛一句原始错误，上传位没有任何出口；现在必须
// 「拿到可读原因 → 等实例就绪 → 自动重传一次」，且失败要抛出可展示的文案。

import { afterEach, describe, expect, it, vi } from "vitest";

import { uploadImageFile } from "./canvas-api";

function jsonRes(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** 按顺序响应 fetch：先上传、再 ensure 轮询、最后重传。 */
function stubFetchSequence(responses: (() => Response | Promise<Response>)[]) {
  const queue = [...responses];
  /* 形参声明成 (input, init)，调用记录才有可断言的元组类型（只写 () 时
   * vi.fn 推出的是空元组，`mock.calls[0][0]` 会被 TS 判越界）。 */
  const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) => {
    const next = queue.shift();
    if (!next) throw new Error("fetch 调用次数超出预期");
    return next();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const file = new File(["x"], "a.png", { type: "image/png" });

describe("uploadImageFile", () => {
  it("ComfyUI 在线：一次上传即可，不触发 ensure", async () => {
    const fetchMock = stubFetchSequence([
      () => jsonRes(200, { name: "up1.png" }),
    ]);

    await expect(uploadImageFile(file)).resolves.toBe("up1.png");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/upload");
  });

  it("未运行（503 comfyui-unreachable）：先等就绪再自动重传一次", async () => {
    const fetchMock = stubFetchSequence([
      () =>
        jsonRes(503, {
          error:
            "无法连接 ComfyUI (http://127.0.0.1:8188)。请确认 ComfyUI 已启动后再上传素材。",
          hint: "comfyui-unreachable",
        }),
      () => jsonRes(200, { ok: true }),
      () => jsonRes(200, { name: "up2.png" }),
    ]);
    const onProgress = vi.fn();

    await expect(uploadImageFile(file, { onProgress })).resolves.toBe(
      "up2.png",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/comfy/ensure");
    expect(onProgress).toHaveBeenCalled();
  });

  it("启动始终不就绪：抛出 ensure 的可读文案（含手动启动指引），不抛原始错误", async () => {
    stubFetchSequence([
      () =>
        jsonRes(503, {
          error: "无法连接 ComfyUI",
          hint: "comfyui-unreachable",
        }),
      () =>
        jsonRes(202, {
          ok: false,
          pending: true,
          detail: "ComfyUI 未运行，且未开启自动启动（设置页可开启）",
        }),
      () =>
        jsonRes(202, {
          ok: false,
          pending: true,
          detail: "ComfyUI 未运行，且未开启自动启动（设置页可开启）",
        }),
    ]);

    const onProgress = vi.fn();
    await expect(
      uploadImageFile(file, { onProgress, readyTimeoutMs: 30 }),
    ).rejects.toThrow(/未开启自动启动/);
    // 进行态在等待期间就已上抛，用户不必等到超时才看到「正在启动」
    expect(onProgress).toHaveBeenCalledWith(
      "ComfyUI 未运行，且未开启自动启动（设置页可开启）",
    );
  });

  it("素材不合规（400）：不可重试，直接抛出后端文案", async () => {
    const fetchMock = stubFetchSequence([
      () => jsonRes(400, { error: "仅支持 PNG / JPG / WebP / GIF 图片" }),
    ]);

    await expect(uploadImageFile(file)).rejects.toThrow(
      "仅支持 PNG / JPG / WebP / GIF 图片",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
