/* 模型选择统一级联的接线守卫（#4834，按源码读不做渲染；先例：workshop-stage-chunk-recovery）。
 * 钉三件结构事实：① 右侧栏不再出现「工作流」字样的选择器（生成资源 → 生成模型摘要）；
 * ② 各生成入口接的是共享级联 ModelCascadeSelect（候选与测试模型页同一份）；
 * ③ 角色卡两块各有小节标题（描述 / 定妆照）。 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { stripComments } from "../../../tests/helpers/strip-comments";

function readSource(rel: string): string {
  return stripComments(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));
}

describe("模型选择统一级联的接线（#4834）", () => {
  const aside = readSource("WorkshopAside.tsx");

  it("右侧栏退场的工作流下拉不再回来（摘要卡替代）", () => {
    expect(aside).not.toContain("生图工作流");
    expect(aside).not.toContain("视频工作流");
    expect(aside).not.toContain("WorkshopWorkflowSelect");
    expect(aside).toContain("生成模型");
    expect(aside).toContain("ModelSummaryRow");
  });

  it("各生成入口接的是共享级联 ModelCascadeSelect（不另立选择器）", () => {
    for (const file of [
      "CharacterDesigner.tsx",
      "ScriptGenerator.tsx",
      "ExtractToolbar.tsx",
      "ShotStudio.tsx",
      "VideoStudio.tsx",
      "CharacterPortraitStudio.tsx",
    ]) {
      expect(readSource(file)).toContain("ModelCascadeSelect");
    }
  });

  it("角色卡两块各有小节标题（角色描述 / 定妆照）", () => {
    const designer = readSource("CharacterDesigner.tsx");
    expect(designer).toContain("角色描述");
    expect(designer).toContain("CharacterPortraitStudio");
    expect(readSource("CharacterPortraitStudio.tsx")).toContain("定妆照");
  });
});
