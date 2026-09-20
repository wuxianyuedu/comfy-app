import { afterEach, describe, expect, it, vi } from "vitest";

import { uploadDatasetImage } from "./dataset-upload-client";

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

describe("uploadDatasetImage", () => {
  it("成功后返回落盘文件名，并把文件放进 image 字段", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonRes(200, { name: "comfyapp_1.png" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadDatasetImage(new File(["x"], "a.png"))).resolves.toBe(
      "comfyapp_1.png",
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/upload");
    expect((init.body as FormData).get("image")).toBeInstanceOf(File);
  });

  it("413：把后端的体积限制文案原样透出", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(jsonRes(413, { error: "图片大小不能超过 50MB" })),
    );
    await expect(uploadDatasetImage(new File(["x"], "a.png"))).rejects.toThrow(
      "图片大小不能超过 50MB",
    );
  });

  it("503 ComfyUI 不可达：透出带地址的排障提示（硬规则：失败须可行动）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonRes(503, {
          error:
            "无法连接 ComfyUI (http://127.0.0.1:8188)。请确认 ComfyUI 已启动后再上传素材。",
          hint: "comfyui-unreachable",
        }),
      ),
    );
    await expect(uploadDatasetImage(new File(["x"], "a.png"))).rejects.toThrow(
      /无法连接 ComfyUI/,
    );
  });

  it("非 2xx 无 error 字段：回落兜底", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes(500, {})));
    await expect(uploadDatasetImage(new File(["x"], "a.png"))).rejects.toThrow(
      "上传失败",
    );
  });

  it("2xx 但缺 name：视为失败", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes(200, {})));
    await expect(uploadDatasetImage(new File(["x"], "a.png"))).rejects.toThrow(
      "响应缺少文件名",
    );
  });
});

/* 错误信封的读法（`readApiError`）用例见 `~/lib/api-error.test.ts`。 */
