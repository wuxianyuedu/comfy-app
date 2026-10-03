// 「实例目录（只读）」行数据的判据：六组的顺序、空组怎么表达、来源标注。
// 这些是口径 —— 界面上「共享输入目录为空」与「共享输入目录指向别处」是两种事实。
import { describe, expect, it } from "vitest";
import type { DesktopStoragePaths } from "~/lib/comfyui/desktop-storage-paths";
import {
  buildStorageRows,
  describeStorageHint,
} from "./comfyui-storage-paths-config";

function storageOf(
  overrides: Partial<DesktopStoragePaths> = {},
): DesktopStoragePaths {
  const dir = (path: string, source: string | null = null) => ({
    path,
    exists: true,
    source,
  });
  return {
    instanceRoot: "D:/installs/ComfyUI2",
    baseDir: "D:/installs/ComfyUI2/ComfyUI",
    extraModelPathsFile: "D:/installs/ComfyUI2/ComfyUI/extra_model_paths.yaml",
    modelDir: dir("D:/installs/ComfyUI2/ComfyUI/models"),
    sharedModelDirs: [dir("D:/shared/models", "comfyui_shared")],
    inputDir: dir("D:/shared/in", "--input-directory"),
    sharedInputDirs: [],
    outputDir: dir("D:/installs/ComfyUI2/ComfyUI/output"),
    sharedOutputDirs: [dir("D:/shared/output", "comfyui_shared")],
    ...overrides,
  };
}

describe("buildStorageRows", () => {
  it("六组按 模型 → 共享模型 → 输入 → 共享输入 → 输出 → 共享输出 排列", () => {
    expect(buildStorageRows(storageOf()).map((row) => row.label)).toEqual([
      "模型目录",
      "共享模型目录",
      "输入目录",
      "共享输入目录",
      "输出目录",
      "共享输出目录",
    ]);
  });

  it("主目录带上覆盖来源，共享行的 source 为空（来源在每条目录上）", () => {
    const rows = buildStorageRows(storageOf());
    const inputRow = rows.find((row) => row.label === "输入目录");
    const sharedInputRow = rows.find((row) => row.label === "共享输入目录");
    expect(inputRow?.source).toBe("--input-directory");
    expect(sharedInputRow?.source).toBeNull();
  });

  it("共享组为空时给空数组（界面据此说「未配置共享目录」）", () => {
    const rows = buildStorageRows(storageOf());
    const sharedInputRow = rows.find((row) => row.label === "共享输入目录");
    expect(sharedInputRow?.dirs).toEqual([]);
    // 主目录永远有一项，哪怕磁盘上并不存在。
    const modelRow = rows.find((row) => row.label === "模型目录");
    expect(modelRow?.dirs).toHaveLength(1);
  });

  it("row.key 稳定且共享/主目录不同名（React key 与测试都靠它）", () => {
    const keys = buildStorageRows(storageOf()).map((row) => row.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("input-shared");
    expect(keys).toContain("input-primary");
  });
});

describe("describeStorageHint", () => {
  it("说清 yaml 落点与「只读」边界", () => {
    const hint = describeStorageHint(storageOf());
    expect(hint).toContain(
      "D:/installs/ComfyUI2/ComfyUI/extra_model_paths.yaml",
    );
    expect(hint).toContain("只读");
  });

  it("没有 yaml 时如实说没有，而不是留空", () => {
    const hint = describeStorageHint(storageOf({ extraModelPathsFile: null }));
    expect(hint).toContain("没有 extra_model_paths.yaml");
  });
});
