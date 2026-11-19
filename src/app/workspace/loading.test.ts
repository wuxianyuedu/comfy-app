/** 硬刷新工作流库时不许再出现整屏转圈（ISSUE #4073 复审第 2 条；#4511 改版）。
 * 路由段 fallback 替换 `ShellTabs`。这里钉住 `/workspace` 的 segment loading：
 * 壳还在（经 `WorkspaceLoadingShell`，导航侧栏渲染真实固定项、不再骨架化），
 * 工作流库的内容分区骨架还在，且没有 PageLoading。 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "../../../tests/helpers/strip-comments";

const source = stripComments(readFileSync(path.resolve(__dirname, "loading.tsx"), "utf8"));

describe("workspace 路由级加载态", () => {
  it("带壳且不是整屏 PageLoading", () => {
    expect(source).toContain("WorkspaceLoadingShell");
    expect(source).not.toContain("PageLoading");
  });

  it("导航侧栏交给 WorkspaceLoadingShell（真实固定项），本文件不再自绘导航骨架", () => {
    expect(source).toContain("WorkspaceLoadingShell");
    expect(source).not.toContain("左侧主导航骨架");
  });

  it("骨架保留顶栏 / 左列表 / 右详情三段内容分区", () => {
    expect(source).toContain("h-11");
    expect(source).toContain("w-72");
    expect(source).toContain("flex-1");
  });
});
