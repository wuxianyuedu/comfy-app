/**
 * 成片首帧的产物地址 → ComfyUI input 文件名（ISSUE #5141）。
 * 工坊定稿的分镜图是 `/api/generated/...`，LoadImage 只认 input 目录里的文件名。
 */
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readFile: vi.fn<(_path: string) => Promise<Buffer>>(),
  uploadImage:
    vi.fn<(_buffer: Buffer, _filename: string, _type: string) => Promise<{ name?: string }>>(),
}));

vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile }));
vi.mock("~/lib/comfyui/client", () => ({ uploadImage: mocks.uploadImage }));

import { resolveFilmFirstFrame } from "./first-frame";

describe("resolveFilmFirstFrame（ISSUE #5141）", () => {
  it("已经是 input 文件名的原样返回，不重复上传", async () => {
    await expect(resolveFilmFirstFrame("ComfyUI_00001.png")).resolves.toBe("ComfyUI_00001.png");
    expect(mocks.uploadImage).not.toHaveBeenCalled();
  });

  it("产物地址 → 读盘 → 上传 input → 换回上传后的文件名", async () => {
    mocks.readFile.mockResolvedValue(Buffer.from([1, 2, 3]));
    mocks.uploadImage.mockResolvedValue({ name: "film_ff_abc.png" });
    await expect(resolveFilmFirstFrame("/api/generated/task/shot.png")).resolves.toBe(
      "film_ff_abc.png",
    );
    expect(mocks.readFile).toHaveBeenCalledTimes(1);
    expect(mocks.uploadImage).toHaveBeenCalledTimes(1);
    const [buffer, filename, type] = mocks.uploadImage.mock.calls[0]!;
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(filename).toMatch(/^film_ff_.*\.png$/);
    expect(type).toBe("input");
  });

  it("非法产物地址抛可读错误，不静默另合成一张", async () => {
    await expect(resolveFilmFirstFrame("/api/generated/../../etc/passwd")).rejects.toThrow(
      /产物地址不合法/,
    );
    expect(mocks.uploadImage).not.toHaveBeenCalled();
  });

  it("上传没拿到文件名时抛错", async () => {
    mocks.readFile.mockResolvedValue(Buffer.from([1]));
    mocks.uploadImage.mockResolvedValue({});
    await expect(resolveFilmFirstFrame("/api/generated/task/shot.png")).rejects.toThrow(/上传失败/);
  });
});
