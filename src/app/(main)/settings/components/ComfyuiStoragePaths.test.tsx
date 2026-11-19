/**
 * `ComfyuiStoragePaths` 的可见行为（设置页「实例目录（只读）」区块）。
 * 断言：六组标签齐全、路径斜杠统一、覆盖来源与「目录不存在」有标注、共享组为
 * 空时说「未配置共享目录」；非桌面实例（storage 为 null）整块不渲染。
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import type { DesktopStoragePaths } from "~/lib/comfyui/desktop-storage-paths";
import { TooltipProvider } from "~/components/ui/tooltip";
import { ComfyuiStoragePaths } from "./ComfyuiStoragePaths";

function storageOf(overrides: Partial<DesktopStoragePaths> = {}): DesktopStoragePaths {
  const dir = (path: string, source: string | null = null, exists = true) => ({
    path,
    exists,
    source,
  });
  return {
    instanceRoot: String.raw`D:\installs\ComfyUI2`,
    baseDir: String.raw`D:\installs\ComfyUI2\ComfyUI`,
    extraModelPathsFile: null,
    modelDir: dir(String.raw`D:\installs\ComfyUI2\ComfyUI\models`),
    sharedModelDirs: [dir(String.raw`D:\shared\models`, "comfyui_shared")],
    inputDir: dir(String.raw`D:\shared\in`, "--input-directory", false),
    sharedInputDirs: [],
    outputDir: dir(String.raw`D:\installs\ComfyUI2\ComfyUI\output`),
    sharedOutputDirs: [dir(String.raw`D:\shared\output`, "comfyui_shared")],
    ...overrides,
  };
}

afterEach(cleanup);

describe("ComfyuiStoragePaths", () => {
  it("非桌面实例（null）整块不渲染", () => {
    const { container } = render(<ComfyuiStoragePaths storage={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("六组标签都在，路径按正斜杠显示（便于逐字对照盘符）", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delay={0}>
        <ComfyuiStoragePaths storage={storageOf()} />
      </TooltipProvider>,
    );
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
    /* 原生 title= 撤干净：完整路径走 <Hint>，悬停可见。 */
    const shown = screen.getByText("D:/installs/ComfyUI2/ComfyUI/models");
    expect(shown).not.toHaveAttribute("title");
    await user.hover(shown);
    await waitFor(() => {
      expect(document.querySelector('[data-slot="tooltip-content"]')).toBeInTheDocument();
    });
    expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent).toContain(
      String.raw`D:\installs\ComfyUI2\ComfyUI\models`,
    );
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
