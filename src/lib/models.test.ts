// syncModels 的收录判据（ISSUE #3368）：ComfyUI 的目录清单与文件列表原样来什么
// 收什么的那个版本把 Custom Nodes 的插件源码当模型收进了库。这里钉住三刀：
// 非模型目录整目录排除、文件按模型扩展名过滤、过滤后为空的目录不落库。

import { beforeEach, describe, expect, it, vi } from "vitest";

const comfy = vi.hoisted(() => ({
  listModelFolders: vi.fn((): Array<string> | Promise<Array<string>> => []),
  listModels: vi.fn((_folder: string): Array<string> | Promise<Array<string>> => []),
}));

const repo = vi.hoisted(() => ({
  disableAllLocal: vi.fn(() => Promise.resolve()),
  /** 参数类型与被测调用对齐：mock.calls 的元素才有东西可断言。 */
  upsertScannedMany: vi.fn(
    (
      _scanned: Array<{
        baseModel: string;
        fileName: string;
        folder: string;
        name: string;
        type: string;
      }>,
    ) => Promise.resolve(),
  ),
}));

vi.mock("~/lib/comfyui/client", () => ({
  listModelFolders: comfy.listModelFolders,
  listModels: comfy.listModels,
}));
vi.mock("~/lib/core/repository", () => ({ modelRepository: repo }));

import { syncModels } from "./models";

beforeEach(() => {
  vi.clearAllMocks();
  comfy.listModelFolders.mockReturnValue([]);
  comfy.listModels.mockReturnValue([]);
});

describe("syncModels 收录判据（ISSUE #3368）", () => {
  it("custom_nodes 整目录排除：连它的文件列表都不去拉", async () => {
    comfy.listModelFolders.mockReturnValue(["checkpoints", "custom_nodes", "Custom Nodes"]);
    comfy.listModels.mockImplementation((folder: string) =>
      folder === "checkpoints" ? ["a.safetensors"] : [],
    );

    const count = await syncModels();

    expect(count).toBe(1);
    expect(comfy.listModels).toHaveBeenCalledTimes(1);
    expect(comfy.listModels).toHaveBeenCalledWith("checkpoints");
  });

  it("文件按扩展名过滤：插件源码 / 文档 / 字体不落库，模型照收", async () => {
    comfy.listModelFolders.mockReturnValue(["checkpoints", "kjnodes_fonts"]);
    comfy.listModels.mockImplementation((folder: string) =>
      folder === "checkpoints"
        ? [
            "waiIllustriousSDXL_v170.safetensors",
            "readme.md",
            "autoencoder.py",
            "layers.cpython-313.pyc",
            ".gitignore",
            "LICENSE",
          ]
        : ["foo.ttf", "bar.ttf"],
    );

    const count = await syncModels();

    expect(count).toBe(1);
    expect(repo.upsertScannedMany).toHaveBeenCalledTimes(1);
    const scanned = repo.upsertScannedMany.mock.calls[0]?.[0];
    expect(Array.isArray(scanned)).toBe(true);
    expect(scanned).toHaveLength(1);
    expect(scanned?.[0]).toMatchObject({
      folder: "checkpoints",
      fileName: "waiIllustriousSDXL_v170.safetensors",
    });
    // kjnodes_fonts 过滤后为空 → 该目录不落库
    expect(scanned?.every((row) => row.folder !== "kjnodes_fonts")).toBe(true);
  });

  it("过滤后没剩任何目录 ⇒ 库保持为空（upsertScannedMany 不被调）", async () => {
    comfy.listModelFolders.mockReturnValue(["custom_nodes"]);
    const count = await syncModels();
    expect(count).toBe(0);
    expect(repo.upsertScannedMany).not.toHaveBeenCalled();
  });

  it("同步先退掉全部 LOCAL 行再回填（既有顺序不变）", async () => {
    comfy.listModelFolders.mockReturnValue(["loras"]);
    comfy.listModels.mockReturnValue(["x.safetensors"]);
    const order: Array<string> = [];
    repo.disableAllLocal.mockImplementation(() => {
      order.push("disable");
      return Promise.resolve();
    });
    repo.upsertScannedMany.mockImplementation(() => {
      order.push("upsert");
      return Promise.resolve();
    });

    await syncModels();

    expect(order).toEqual(["disable", "upsert"]);
  });
});
