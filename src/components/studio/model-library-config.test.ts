import { describe, expect, it } from "vitest";

import {
  type ModelRow,
  countByType,
  filterModels,
  fmtSize,
  foldersOf,
} from "./model-library-config";

function row(partial: Partial<ModelRow> & { id: string }): ModelRow {
  return {
    name: "unnamed",
    type: "checkpoints",
    fileName: "unnamed.safetensors",
    isAvailable: true,
    fileSize: null,
    ...partial,
  };
}

const models: Array<ModelRow> = [
  row({
    id: "1",
    name: "dreamshaper-xl",
    type: "checkpoints",
    fileName: "ds-xl.safetensors",
  }),
  row({
    id: "2",
    name: "Detail Tweaker",
    type: "loras",
    fileName: "sub/detail.safetensors",
  }),
  row({
    id: "3",
    name: "Anime Style",
    type: "loras",
    fileName: "anime.safetensors",
  }),
];

describe("filterModels", () => {
  it("目录为 null 时不按目录过滤", () => {
    expect(filterModels(models, null, "")).toHaveLength(3);
  });

  it("按目录过滤", () => {
    expect(filterModels(models, "loras", "").map((m) => m.id)).toEqual(["2", "3"]);
  });

  it("关键字命中名称或文件名（大小写不敏感）", () => {
    expect(filterModels(models, null, "XL").map((m) => m.id)).toEqual(["1"]);
    // sub/detail.safetensors —— 文件路径也算命中（用户常按文件名搜）
    expect(filterModels(models, null, "sub/").map((m) => m.id)).toEqual(["2"]);
  });

  it("目录与关键字是与关系", () => {
    expect(filterModels(models, "loras", "dreamshaper")).toEqual([]);
  });

  it("纯空白关键字视为无筛选（输入一个空格不该清空列表）", () => {
    expect(filterModels(models, null, "   ")).toHaveLength(3);
  });
});

describe("countByType", () => {
  it("按数量降序，同数量按类型名字典序", () => {
    const counts = countByType(models);
    expect(counts).toEqual([
      ["loras", 2],
      ["checkpoints", 1],
    ]);
  });

  it("空列表返回空数组", () => {
    expect(countByType([])).toEqual([]);
  });
});

describe("foldersOf", () => {
  it("由模型派生目录列，顺序与计数和 countByType 一致", () => {
    expect(foldersOf(models).map((folder) => [folder.type, folder.count])).toEqual([
      ["loras", 2],
      ["checkpoints", 1],
    ]);
  });

  it("只列有模型的目录（空库不给目录）", () => {
    expect(foldersOf([])).toEqual([]);
  });
});

describe("fmtSize", () => {
  it("空 / 0 显示「—」", () => {
    expect(fmtSize(null)).toBe("—");
    expect(fmtSize(undefined)).toBe("—");
    expect(fmtSize(0)).toBe("—");
  });

  it("按量级换挡", () => {
    expect(fmtSize(5120)).toBe("5 KB");
    expect(fmtSize(20 * 1024 * 1024)).toBe("20 MB");
    expect(fmtSize(6 * 1024 * 1024 * 1024)).toBe("6.0 GB");
  });
});
