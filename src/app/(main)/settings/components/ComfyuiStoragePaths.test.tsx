// @vitest-environment jsdom
/**
 * `ComfyuiStoragePaths` 的可见行为（设置页「实例目录（只读）」区块）。
 *
 * 断言对齐用户能看到的四件事：六组标签都在、路径按斜杠统一显示、覆盖来源与
 * 「目录不存在」有标注、共享组为空时说「未配置共享目录」。非桌面实例
 * （storage 为 null）整块不渲染 —— 那是「不适用」而不是「空目录」。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { DesktopStoragePaths } from "~/lib/comfyui/desktop-storage-paths";
import { ComfyuiStoragePaths } from "./ComfyuiStoragePaths";

function storageOf(
  overrides: Partial<DesktopStoragePaths> = {},
): DesktopStoragePaths {
  const dir = (path: string, source: string | null = null, exists = true) => ({
    path,
    exists,
    source,
  });
  return {
    instanceRoot: "D:\\installs\\ComfyUI2",
    baseDir: "D:\\installs\\ComfyUI2\\ComfyUI",
    extraModelPathsFile: null,
    modelDir: dir("D:\\installs\\ComfyUI2\\ComfyUI\\models"),
    sharedModelDirs: [dir("D:\\shared\\models", "comfyui_shared")],
    inputDir: dir("D:\\shared\\in", "--input-directory", false),
    sharedInputDirs: [],
    outputDir: dir("D:\\installs\\ComfyUI2\\ComfyUI\\output"),
    sharedOutputDirs: [dir("D:\\shared\\output", "comfyui_shared")],
    ...overrides,
  };
}

afterEach(cleanup);

describe("ComfyuiStoragePaths", () => {
  it("非桌面实例（null）整块不渲染", () => {
    const { container } = render(<ComfyuiStoragePaths storage={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("六组标签都在，路径按正斜杠显示（便于逐字对照盘符）", () => {
    render(<ComfyuiStoragePaths storage={storageOf()} />);
    for (const label of [
      "模型目录",
      "共享模型目录",
      "输入目录",
      "共享输入目录",
      "输出目录",
      "共享输出目录",
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(
      screen.getByTitle("D:\\installs\\ComfyUI2\\ComfyUI\\models").textContent,
    ).toBe("D:/installs/ComfyUI2/ComfyUI/models");
  });

  it("覆盖来源与「目录不存在」都有标注", () => {
    render(<ComfyuiStoragePaths storage={storageOf()} />);
    expect(screen.getByText("（来自 --input-directory）")).toBeTruthy();
    expect(screen.getByText("· 目录不存在")).toBeTruthy();
    // 共享目录行标的是 yaml 条目名（模型 / 输出两组各一处）。
    expect(screen.getAllByText("（来自 comfyui_shared）")).toHaveLength(2);
  });

  it("共享组为空时明说「未配置共享目录」（而不是留一行空白）", () => {
    render(<ComfyuiStoragePaths storage={storageOf()} />);
    expect(screen.getByText("未配置共享目录")).toBeTruthy();
  });

  it("底部说明写出只读边界", () => {
    render(<ComfyuiStoragePaths storage={storageOf()} />);
    expect(screen.getByText(/修改请在 ComfyUI Desktop 里进行/)).toBeTruthy();
  });
});
