import { describe, expect, it } from "vitest";

import {
  ALL_TYPES,
  type FolderConfigRow,
  type ModelRow,
  countByType,
  filterFolders,
  filterModels,
  fmtSize,
  splitFolders,
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

const models: ModelRow[] = [
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
  it("ALL 不按类型过滤", () => {
    expect(filterModels(models, ALL_TYPES, "")).toHaveLength(3);
  });

  it("按类型过滤", () => {
    expect(filterModels(models, "loras", "").map((m) => m.id)).toEqual([
      "2",
      "3",
    ]);
  });

  it("关键字命中名称或文件名（大小写不敏感）", () => {
    expect(filterModels(models, ALL_TYPES, "XL").map((m) => m.id)).toEqual([
      "1",
    ]);
    // sub/detail.safetensors —— 文件路径也算命中（用户常按文件名搜）
    expect(filterModels(models, ALL_TYPES, "sub/").map((m) => m.id)).toEqual([
      "2",
    ]);
  });

  it("类型与关键字是与关系", () => {
    expect(filterModels(models, "loras", "dreamshaper")).toEqual([]);
  });

  it("纯空白关键字视为无筛选（输入一个空格不该清空列表）", () => {
    expect(filterModels(models, ALL_TYPES, "   ")).toHaveLength(3);
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

function folder(
  partial: Partial<FolderConfigRow> & { folder: string },
): FolderConfigRow {
  return {
    type: partial.folder,
    label: partial.folder,
    enabled: false,
    hasConfig: false,
    count: 0,
    ...partial,
  };
}

describe("filterFolders", () => {
  const rows = [
    folder({ folder: "checkpoints", label: "大模型" }),
    folder({ folder: "loras", label: "LoRA" }),
  ];

  it("无关键字原样返回", () => {
    expect(filterFolders(rows, "")).toBe(rows);
  });

  it("目录名与展示标签都参与匹配", () => {
    expect(filterFolders(rows, "check").map((r) => r.folder)).toEqual([
      "checkpoints",
    ]);
    expect(filterFolders(rows, "lora").map((r) => r.folder)).toEqual(["loras"]);
  });
});

describe("splitFolders", () => {
  const rows = [
    folder({ folder: "checkpoints", enabled: true }),
    folder({ folder: "loras", enabled: false }),
  ];

  it("拆成已启用 / 可添加两组", () => {
    const { enabled, available } = splitFolders(rows, "");
    expect(enabled.map((r) => r.folder)).toEqual(["checkpoints"]);
    expect(available.map((r) => r.folder)).toEqual(["loras"]);
  });

  it("关键字先过滤再分组", () => {
    const { enabled, available } = splitFolders(rows, "lora");
    expect(enabled).toEqual([]);
    expect(available.map((r) => r.folder)).toEqual(["loras"]);
  });
});
