import type { Mock } from "vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { uploadBgm } from "./bgm-client";

type FetchMock = Mock<typeof fetch>;

/** 造一个带 JSON 体的 Response；非法 JSON 走 reject */
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

describe("uploadBgm", () => {
  it("成功后返回服务端文件名", async () => {
    const fetchMock: FetchMock = vi
      .fn()
      .mockResolvedValue(jsonRes(200, { name: "bgm.mp3" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadBgm(new File(["x"], "bgm.mp3"))).resolves.toBe(
      "bgm.mp3",
    );

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/film/bgm");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
  });

  it("非 2xx：抛出响应里的 error 文案（后端一律 { error: string }）", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonRes(400, { error: "仅支持 MP3 / WAV / M4A / OGG 音频" }),
        ),
    );
    await expect(uploadBgm(new File(["x"], "a.wav"))).rejects.toThrow(
      "仅支持 MP3 / WAV / M4A / OGG 音频",
    );
  });

  it("非 2xx 且无 error 字段：回落兜底文案（失败路径必须有可读出口）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes(500, {})));
    await expect(uploadBgm(new File(["x"], "a.wav"))).rejects.toThrow(
      "BGM 上传失败",
    );
  });

  it("2xx 但缺 name：视为失败并给出可定位的文案", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonRes(200, { ok: true })),
    );
    await expect(uploadBgm(new File(["x"], "a.wav"))).rejects.toThrow(
      "响应缺少文件名",
    );
  });

  it("2xx 但 name 是空串：同样视为失败（否则界面会显示空的已选 BGM）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonRes(200, { name: "" })),
    );
    await expect(uploadBgm(new File(["x"], "a.wav"))).rejects.toThrow(
      "响应缺少文件名",
    );
  });

  it("响应体不是合法 JSON：按空对象处理，不把解析异常抛给用户", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => {
          throw new SyntaxError("Unexpected token <");
        },
      } as unknown as Response),
    );
    await expect(uploadBgm(new File(["x"], "a.wav"))).rejects.toThrow(
      "BGM 上传失败",
    );
  });
});

/* 错误信封的读法（`readApiError`）用例见 `~/lib/api-error.test.ts` —— 收口前
 * bgm / upload / materials 三份**逐字相同**的读取函数各带一组同款用例。 */
