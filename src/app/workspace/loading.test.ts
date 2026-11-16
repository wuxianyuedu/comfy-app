/** 硬刷新工作流库时不许再出现整屏转圈（ISSUE #4073 复审第 2 条）。
 * 路由段 fallback 替换 `ShellTabs`，此前落到根 `app/loading.tsx` 的
 * `ShellFullPage + PageLoading` —— 侧栏、页签、左右分栏一起消失。这里钉住
 * `/workspace` 自己的 segment loading 是**同形态骨架**：壳还在，内容分区还在，
 * 且没有 PageLoading。 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "../../../tests/helpers/strip-comments";

const source = stripComments(readFileSync(path.resolve(__dirname, "loading.tsx"), "utf8"));

describe("workspace 路由级加载态", () => {
  it("带壳且不是整屏 PageLoading", () => {
    expect(source).toContain("ShellFullPage");
    expect(source).not.toContain("PageLoading");
  });

  it("骨架保留导航 / 顶栏 / 左列表 / 右详情四段分区", () => {
    expect(source).toContain('aria-label="工作区加载中"');
    expect(source).toContain("w-56");
    expect(source).toContain("h-11");
    expect(source).toContain("w-72");
    expect(source).toContain("flex-1");
  });
});
